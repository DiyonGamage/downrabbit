use siphon_core::engines::reddit::{parse_reddit_json, RedditExtractor};
use siphon_core::extractor::Extractor;
use siphon_core::types::{MediaKind, StreamKind};
use url::Url;

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("fixtures/reddit_post.json")).unwrap()
}

#[test]
fn parses_video_url() {
    let plan = parse_reddit_json(&fixture()).unwrap();
    assert_eq!(plan.service, "reddit");
    let item = &plan.items[0];
    assert_eq!(item.kind, MediaKind::Video);
    assert!(!item.needs_merge);
    assert_eq!(item.streams[0].kind, StreamKind::Video);
    assert!(item.streams[0].url.starts_with("https://v.redd.it/"));
    assert_eq!(item.filename, "Reddit Clip.mp4");
}

#[test]
fn matches_reddit_hosts() {
    let e = RedditExtractor;
    assert!(e.matches(&Url::parse("https://www.reddit.com/r/x/comments/1").unwrap()));
    assert!(e.matches(&Url::parse("https://redd.it/abc").unwrap()));
    assert!(!e.matches(&Url::parse("https://youtube.com/watch?v=1").unwrap()));
}