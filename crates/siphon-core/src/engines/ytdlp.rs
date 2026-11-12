use crate::error::{Result, SiphonError};
use crate::extractor::Extractor;
use crate::types::*;
use crate::url::sanitize_filename;
use async_trait::async_trait;
use serde_json::Value;
use url::Url;

pub struct YtdlpExtractor;

fn best_video(formats: &[Value], max_height: Option<u32>) -> Option<&Value> {
    formats
        .iter()
        .filter(|f| f["vcodec"].as_str().unwrap_or("none") != "none")
        .filter(|f| match max_height {
            Some(h) => f["height"].as_u64().unwrap_or(0) <= h as u64,
            None => true,
        })
        .max_by_key(|f| f["height"].as_u64().unwrap_or(0))
}

fn best_audio(formats: &[Value]) -> Option<&Value> {
    formats
        .iter()
        .filter(|f| f["acodec"].as_str().unwrap_or("none") != "none")
        .filter(|f| f["vcodec"].as_str().unwrap_or("none") == "none")
        .max_by_key(|f| f["abr"].as_u64().unwrap_or(0))
}

fn stream_from(f: &Value, kind: StreamKind) -> Stream {
    Stream {
        url: f["url"].as_str().unwrap_or("").to_string(),
        kind,
        headers: vec![],
        ext: f["ext"].as_str().unwrap_or("mp4").to_string(),
    }
}

pub fn parse_ytdlp_json(v: &Value, opts: &Options) -> Result<MediaPlan> {
    let title = v["title"].as_str().unwrap_or("download");
    let duration = v["duration"].as_f64();
    let formats = v["formats"].as_array().cloned().unwrap_or_default();
    if formats.is_empty() {
        return Err(SiphonError::Extract("no formats in yt-dlp output".into()));
    }

    let (streams, needs_merge, ext) = match opts.mode {
        Mode::Audio => {
            let a = best_audio(&formats)
                .or_else(|| formats.iter().find(|f| f["acodec"].as_str().unwrap_or("none") != "none"))
                .ok_or_else(|| SiphonError::Extract("no audio format".into()))?;
            (vec![stream_from(a, StreamKind::Audio)], false, a["ext"].as_str().unwrap_or("m4a").to_string())
        }
        _ => {
            let vid = best_video(&formats, opts.max_height)
                .ok_or_else(|| SiphonError::Extract("no video format".into()))?;
            if vid["acodec"].as_str().unwrap_or("none") != "none" {
                (vec![stream_from(vid, StreamKind::Video)], false, vid["ext"].as_str().unwrap_or("mp4").to_string())
            } else {
                let aud = best_audio(&formats);
                let mut s = vec![stream_from(vid, StreamKind::Video)];
                let merge = aud.is_some();
                if let Some(a) = aud {
                    s.push(stream_from(a, StreamKind::Audio));
                }
                (s, merge, vid["ext"].as_str().unwrap_or("mp4").to_string())
            }
        }
    };

    let item = MediaItem {
        kind: if opts.mode == Mode::Audio { MediaKind::Audio } else { MediaKind::Video },
        streams,
        needs_merge,
        filename: sanitize_filename(title, &ext),
        title: title.to_string(),
        duration,
        ext,
    };
    Ok(MediaPlan { service: "yt-dlp".into(), items: vec![item] })
}

#[async_trait]
impl Extractor for YtdlpExtractor {
    fn id(&self) -> &'static str { "yt-dlp" }
    fn matches(&self, _url: &Url) -> bool { true }

    async fn extract(&self, url: &Url, opts: &Options) -> Result<MediaPlan> {
        let output = tokio::process::Command::new("yt-dlp")
            .args(["--dump-single-json", "--no-download", "--no-warnings", url.as_str()])
            .output()
            .await
            .map_err(|e| SiphonError::Extract(format!("spawn yt-dlp: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(SiphonError::Extract(format!("yt-dlp: {}", stderr.trim())));
        }
        let v: Value = serde_json::from_slice(&output.stdout)?;
        parse_ytdlp_json(&v, opts)
    }
}