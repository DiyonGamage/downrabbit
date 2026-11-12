use crate::error::{Result, SiphonError};
use crate::extractor::Extractor;
use crate::types::*;
use crate::url::sanitize_filename;
use async_trait::async_trait;
use serde_json::Value;
use url::Url;

pub struct RedditExtractor;

pub fn parse_reddit_json(v: &Value) -> Result<MediaPlan> {
    let post = &v[0]["data"]["children"][0]["data"];
    let rv = &post["secure_media"]["reddit_video"];
    let url = rv["fallback_url"]
        .as_str()
        .ok_or_else(|| SiphonError::Extract("no reddit_video fallback_url".into()))?;
    let title = post["title"].as_str().unwrap_or("reddit");
    let duration = rv["duration"].as_f64();
    let item = MediaItem {
        kind: MediaKind::Video,
        streams: vec![Stream {
            url: url.to_string(),
            kind: StreamKind::Video,
            headers: vec![],
            ext: "mp4".into(),
        }],
        needs_merge: false,
        filename: sanitize_filename(title, "mp4"),
        title: title.to_string(),
        duration,
        ext: "mp4".into(),
    };
    Ok(MediaPlan { service: "reddit".into(), items: vec![item] })
}

#[async_trait]
impl Extractor for RedditExtractor {
    fn id(&self) -> &'static str { "reddit" }

    fn matches(&self, url: &Url) -> bool {
        matches!(url.host_str(), Some("reddit.com") | Some("www.reddit.com") | Some("redd.it") | Some("v.redd.it"))
    }

    async fn extract(&self, url: &Url, _opts: &Options) -> Result<MediaPlan> {
        let mut json_url = url.clone();
        let path = json_url.path().trim_end_matches('/').to_string();
        json_url.set_path(&format!("{path}.json"));
        json_url.set_query(None);

        let client = reqwest::Client::builder()
            .user_agent("siphon/0.0 (media downloader)")
            .build()?;
        let resp = client.get(json_url).send().await?;
        let v: Value = resp.json().await?;
        parse_reddit_json(&v)
    }
}