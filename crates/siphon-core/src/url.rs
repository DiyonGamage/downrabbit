use crate::error::{Result, SiphonError};
use url::Url;

pub fn normalize_url(input: &str) -> Result<Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(SiphonError::Unsupported("empty input".into()));
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&candidate)
        .map_err(|e| SiphonError::Unsupported(format!("invalid url: {e}")))?;
    if parsed.host_str().is_none() {
        return Err(SiphonError::Unsupported("no host".into()));
    }
    Ok(parsed)
}

pub fn sanitize_filename(name: &str, ext: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.replace("..", "_").trim().trim_matches('.').to_string();
    let base = if cleaned.is_empty() { "download".to_string() } else { cleaned };
    let base = base.strip_suffix(&format!(".{ext}")).unwrap_or(&base);
    let mut base = base.to_string();
    if base.len() > 180 {
        let mut end = 180;
        while end > 0 && !base.is_char_boundary(end) {
            end -= 1;
        }
        base.truncate(end);
    }
    format!("{base}.{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_scheme_when_missing() {
        let u = normalize_url("youtube.com/watch?v=abc").unwrap();
        assert_eq!(u.scheme(), "https");
        assert_eq!(u.host_str(), Some("youtube.com"));
    }

    #[test]
    fn trims_whitespace() {
        let u = normalize_url("  https://youtu.be/abc  ").unwrap();
        assert_eq!(u.host_str(), Some("youtu.be"));
    }

    #[test]
    fn rejects_garbage() {
        assert!(normalize_url("not a url at all").is_err());
    }

    #[test]
    fn sanitize_strips_unsafe_and_traversal() {
        let f = sanitize_filename("../../ev*il:<>|?name", "mp4");
        assert!(!f.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']));
        assert!(!f.contains(".."));
        assert!(f.ends_with(".mp4"));
    }

    #[test]
    fn sanitize_empty_falls_back() {
        let f = sanitize_filename("", "mp4");
        assert_eq!(f, "download.mp4");
    }

    #[test]
    fn sanitize_does_not_double_ext() {
        let f = sanitize_filename("clip.mp4", "mp4");
        assert_eq!(f, "clip.mp4");
    }

    #[test]
    fn sanitize_truncates_multibyte_without_panic() {
        let name = format!("{}漢", "a".repeat(179)); // 179 ASCII + 3-byte char straddling byte 180
        let f = sanitize_filename(&name, "mp4");
        assert!(f.ends_with(".mp4"));
        let base = f.strip_suffix(".mp4").unwrap();
        assert!(base.len() <= 180);
        assert!(!base.is_empty());
    }
}
