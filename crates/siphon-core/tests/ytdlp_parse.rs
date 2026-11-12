use siphon_core::engines::ytdlp::parse_ytdlp_json;
use siphon_core::types::{Mode, Options, StreamKind};

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("fixtures/ytdlp_single.json")).unwrap()
}

#[test]
fn auto_picks_best_video_plus_audio_and_needs_merge() {
    let plan = parse_ytdlp_json(&fixture(), &Options::default()).unwrap();
    assert_eq!(plan.service, "yt-dlp");
    let item = &plan.items[0];
    assert!(item.needs_merge);
    let v = item.streams.iter().find(|s| s.kind == StreamKind::Video).unwrap();
    assert_eq!(v.url, "https://cdn/v1080");
    assert!(item.streams.iter().any(|s| s.kind == StreamKind::Audio));
    assert_eq!(item.filename, "Sample Clip.mp4");
}

#[test]
fn max_height_caps_video() {
    let mut o = Options::default();
    o.max_height = Some(720);
    let plan = parse_ytdlp_json(&fixture(), &o).unwrap();
    let v = plan.items[0].streams.iter().find(|s| s.kind == StreamKind::Video).unwrap();
    assert_eq!(v.url, "https://cdn/v720");
}

#[test]
fn audio_mode_selects_audio_only() {
    let mut o = Options::default();
    o.mode = Mode::Audio;
    let plan = parse_ytdlp_json(&fixture(), &o).unwrap();
    let item = &plan.items[0];
    assert!(!item.needs_merge);
    assert_eq!(item.streams.len(), 1);
    assert_eq!(item.streams[0].kind, StreamKind::Audio);
}