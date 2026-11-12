use siphon_core::download::download_segmented;
use siphon_core::engines::reddit::RedditExtractor;
use siphon_core::engines::ytdlp::YtdlpExtractor;
use siphon_core::error::{Result, SiphonError};
use siphon_core::ffmpeg::merge;
use siphon_core::router::ExtractorRouter;
use siphon_core::types::{Options, StreamKind};
use siphon_core::url::normalize_url;
use std::path::{Path, PathBuf};
use std::time::Instant;

pub struct RunStats {
    pub bytes: u64,
    pub elapsed_ms: u128,
    pub output: PathBuf,
    pub service: String,
}

pub fn router() -> ExtractorRouter {
    ExtractorRouter::new(vec![Box::new(RedditExtractor), Box::new(YtdlpExtractor)])
}

pub async fn run_once(url: &str, out_dir: &Path, connections: usize, opts: &Options) -> Result<RunStats> {
    let start = Instant::now();
    let parsed = normalize_url(url)?;
    let plan = router().resolve(&parsed, opts).await?;
    let service = plan.service.clone();
    let item = plan.items.into_iter().next()
        .ok_or_else(|| SiphonError::Extract("empty plan".into()))?;

    tokio::fs::create_dir_all(out_dir).await?;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (siphon)")
        .build()?;

    let mut video_part: Option<PathBuf> = None;
    let mut audio_part: Option<PathBuf> = None;
    let mut single: Option<PathBuf> = None;
    let mut bytes = 0u64;

    for s in &item.streams {
        let tmp = out_dir.join(format!(".part-{:?}.{}", s.kind, s.ext));
        let n = download_segmented(&client, &s.url, &s.headers, &tmp, connections).await?;
        bytes += n;
        match s.kind {
            StreamKind::Video => {
                if item.streams.len() == 1 { single = Some(tmp); } else { video_part = Some(tmp); }
            }
            StreamKind::Audio => audio_part = Some(tmp),
            StreamKind::Subtitle => {}
        }
    }

    let final_path = out_dir.join(&item.filename);
    if item.needs_merge {
        let v = video_part.ok_or_else(|| SiphonError::Download("missing video part".into()))?;
        let a = audio_part.ok_or_else(|| SiphonError::Download("missing audio part".into()))?;
        merge(&v, &a, &final_path).await?;
        let _ = tokio::fs::remove_file(&v).await;
        let _ = tokio::fs::remove_file(&a).await;
    } else if let Some(s) = single {
        tokio::fs::rename(&s, &final_path).await?;
    } else if let Some(v) = video_part {
        tokio::fs::rename(&v, &final_path).await?;
    } else if let Some(a) = audio_part {
        tokio::fs::rename(&a, &final_path).await?;
    }

    Ok(RunStats { bytes, elapsed_ms: start.elapsed().as_millis(), output: final_path, service })
}