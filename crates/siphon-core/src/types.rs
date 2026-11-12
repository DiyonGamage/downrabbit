use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Auto, Audio, Mute }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Options {
    pub mode: Mode,
    pub max_height: Option<u32>,
    pub audio_format: String,
    pub audio_bitrate: u32,
    pub subtitle_lang: Option<String>,
    pub embed_metadata: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            mode: Mode::Auto,
            max_height: Some(1080),
            audio_format: "mp3".into(),
            audio_bitrate: 128,
            subtitle_lang: None,
            embed_metadata: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind { Video, Audio, Image, Gif }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind { Video, Audio, Subtitle }

#[derive(Debug, Clone)]
pub struct Stream {
    pub url: String,
    pub kind: StreamKind,
    pub headers: Vec<(String, String)>,
    pub ext: String,
}

#[derive(Debug, Clone)]
pub struct MediaItem {
    pub kind: MediaKind,
    pub streams: Vec<Stream>,
    pub needs_merge: bool,
    pub filename: String,
    pub title: String,
    pub duration: Option<f64>,
    pub ext: String,
}

#[derive(Debug, Clone)]
pub struct MediaPlan {
    pub service: String,
    pub items: Vec<MediaItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_default_is_auto_1080_mp3_128() {
        let o = Options::default();
        assert_eq!(o.mode, Mode::Auto);
        assert_eq!(o.max_height, Some(1080));
        assert_eq!(o.audio_format, "mp3");
        assert_eq!(o.audio_bitrate, 128);
        assert!(o.embed_metadata);
    }

    #[test]
    fn mode_serde_lowercase() {
        let j = serde_json::to_string(&Mode::Audio).unwrap();
        assert_eq!(j, "\"audio\"");
        let m: Mode = serde_json::from_str("\"mute\"").unwrap();
        assert_eq!(m, Mode::Mute);
    }

    #[test]
    fn media_plan_holds_items() {
        let plan = MediaPlan {
            service: "youtube".into(),
            items: vec![MediaItem {
                kind: MediaKind::Video,
                streams: vec![Stream {
                    url: "https://x/v".into(),
                    kind: StreamKind::Video,
                    headers: vec![],
                    ext: "mp4".into(),
                }],
                needs_merge: true,
                filename: "title.mp4".into(),
                title: "title".into(),
                duration: Some(12.0),
                ext: "mp4".into(),
            }],
        };
        assert_eq!(plan.items.len(), 1);
        assert!(plan.items[0].needs_merge);
    }
}
