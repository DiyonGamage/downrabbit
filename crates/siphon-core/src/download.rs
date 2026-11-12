use crate::error::{Result, SiphonError};
use futures::future::try_join_all;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RANGE};
use std::path::Path;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

pub fn split_ranges(total: u64, n: usize) -> Vec<(u64, u64)> {
    if total == 0 {
        return vec![];
    }
    let n = (n.max(1) as u64).min(total);
    let chunk = total / n;
    let mut ranges = Vec::new();
    let mut start = 0u64;
    for i in 0..n {
        let end = if i == n - 1 { total - 1 } else { start + chunk - 1 };
        ranges.push((start, end));
        start = end + 1;
    }
    ranges
}

fn build_headers(headers: &[(String, String)]) -> Result<HeaderMap> {
    let mut map = HeaderMap::new();
    for (k, v) in headers {
        let name = HeaderName::from_bytes(k.as_bytes())
            .map_err(|e| SiphonError::Download(format!("bad header name: {e}")))?;
        let val = HeaderValue::from_str(v)
            .map_err(|e| SiphonError::Download(format!("bad header value: {e}")))?;
        map.insert(name, val);
    }
    Ok(map)
}

pub async fn download_segmented(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
    dest: &Path,
    connections: usize,
) -> Result<u64> {
    let base_headers = build_headers(headers)?;

    // Probe size + range support with a 0-0 request.
    let probe = client
        .get(url)
        .headers(base_headers.clone())
        .header(RANGE, "bytes=0-0")
        .send()
        .await?;
    let supports_range = probe.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let total = probe
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|s| s.parse::<u64>().ok());

    let file = tokio::fs::File::create(dest).await?;
    drop(file);

    let ranges: Vec<(u64, u64)> = match (supports_range, total) {
        (true, Some(t)) if t > 0 => split_ranges(t, connections),
        _ => vec![(0, u64::MAX)], // single streamed GET fallback
    };

    let tasks = ranges.into_iter().map(|(start, end)| {
        let client = client.clone();
        let url = url.to_string();
        let base_headers = base_headers.clone();
        let dest = dest.to_path_buf();
        async move {
            let mut req = client.get(&url).headers(base_headers);
            let single = end == u64::MAX;
            if !single {
                req = req.header(RANGE, format!("bytes={start}-{end}"));
            }
            let mut resp = req.send().await?;
            if !resp.status().is_success() {
                return Err(SiphonError::Download(format!("status {}", resp.status())));
            }
            let mut file = tokio::fs::OpenOptions::new().write(true).open(&dest).await?;
            if !single {
                file.seek(std::io::SeekFrom::Start(start)).await?;
            }
            let mut written = 0u64;
            while let Some(chunk) = resp.chunk().await? {
                file.write_all(&chunk).await?;
                written += chunk.len() as u64;
            }
            file.flush().await?;
            Ok::<u64, SiphonError>(written)
        }
    });

    let counts = try_join_all(tasks).await?;
    Ok(counts.into_iter().sum())
}