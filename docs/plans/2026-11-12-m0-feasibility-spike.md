# Siphon M0 — Feasibility Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, with real numbers, that a local Rust + yt-dlp + ffmpeg downloader hits Siphon's resource/speed targets and that the hybrid extractor architecture works — before any UI is built.

**Architecture:** A headless Cargo workspace. `siphon-core` is the reusable foundation (types, `Extractor` trait, router, yt-dlp adapter, one native Reddit extractor, segmented downloader, ffmpeg merge). `siphon-bench` is a CLI + measurement harness that drives Core end-to-end and reports RAM/CPU/startup/throughput against the spec targets. Core carries forward into M1; only the measurement scaffolding is spike-grade.

**Tech Stack:** Rust (edition 2021), tokio, reqwest (rustls), serde/serde_json, url, async-trait, thiserror, clap, sysinfo, futures, tempfile. External tools: yt-dlp (Unlicense), ffmpeg (system for M0; LGPL build for shipping later).

**Spec:** `siphon/docs/specs/2026-11-12-siphon-design.md`

## Global Constraints

- Platform: Windows 10/11 x64 first (commands run in Git Bash).
- Clean-room: NO cobalt source copied; only behavior/API-shape inspiration. All code fresh.
- License: Apache-2.0 for our code; dependencies must be commercial-safe (yt-dlp Unlicense, ffmpeg LGPL).
- Security: pass yt-dlp/ffmpeg arguments as argv arrays, NEVER via shell strings (no command injection). Sanitize filenames; guard path traversal.
- Privacy: zero telemetry; network only for downloads.
- Defaults: download connections = 8; simultaneous jobs = 2 (M0 downloads one job at a time).
- Resource targets (spec §9): active-job RAM ≤ 150 MB worst case (≤ 80 MB native, no merge); cold startup < 300 ms; throughput ≥ cobalt, target 2–5x on large files. M0 measures active RAM, startup, throughput. Idle RAM / installer size are M1+ concerns.
- UI art direction (dark matte, terminal feel, rabbit mascot) is M1+; M0 has no UI.
- Integration tests that hit the network are gated behind env var `SIPHON_NET=1` so offline runs skip them.

## File Structure

```
siphon/
  Cargo.toml                      # workspace root
  .gitignore
  LICENSE                         # Apache-2.0
  README.md                       # short stub
  crates/
    siphon-core/
      Cargo.toml
      src/
        lib.rs                    # re-exports
        error.rs                  # SiphonError
        types.rs                  # Mode, Options, MediaKind, StreamKind, Stream, MediaItem, MediaPlan
        url.rs                    # normalize_url, sanitize_filename
        extractor.rs              # Extractor trait
        router.rs                 # ExtractorRouter
        engines/
          mod.rs
          ytdlp.rs                # yt-dlp adapter + parse_ytdlp_json
          reddit.rs               # native Reddit extractor + parse_reddit_json
        download.rs               # split_ranges + download_segmented
        ffmpeg.rs                 # merge_args + merge
      tests/
        fixtures/ytdlp_single.json
        fixtures/reddit_post.json
        routing.rs                # router unit tests (mock extractors)
        ytdlp_parse.rs            # offline parse tests
        reddit_parse.rs           # offline parse tests
        download_local.rs         # segmented download vs local test server
        ffmpeg_merge.rs           # offline merge of generated streams
        net_download.rs           # network-gated end-to-end
    siphon-bench/
      Cargo.toml
      src/
        main.rs                   # CLI: `run <url>` and `bench`
        measure.rs                # peak RAM / CPU / startup / throughput sampler
  docs/
    specs/2026-11-12-siphon-design.md
    plans/2026-11-12-m0-feasibility-spike.md
    reports/                      # m0-report.md written by bench
```

---

### Task 1: Project scaffold + environment

**Files:**
- Create: `siphon/Cargo.toml`, `siphon/.gitignore`, `siphon/LICENSE`, `siphon/README.md`, `siphon/crates/siphon-core/Cargo.toml`, `siphon/crates/siphon-core/src/lib.rs`, `siphon/crates/siphon-bench/Cargo.toml`, `siphon/crates/siphon-bench/src/main.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: a building Cargo workspace with two crates; `yt-dlp` on PATH; git repo initialized.

- [ ] **Step 1: Install yt-dlp (requires user approval for system install)**

Run: `winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements`
Then verify: `yt-dlp --version`
Expected: a version string (e.g. `2026.x.x`). If winget fails, fallback: `python -m pip install --user yt-dlp` then `python -m yt_dlp --version`.
Also verify ffmpeg: `ffmpeg -version` (already present: 8.1.2).

- [ ] **Step 2: Initialize git repo**

Run:
```bash
cd "C:/Users/diyon/Documents/top1%/jarvis max/siphon"
git init
```
Expected: `Initialized empty Git repository`.

- [ ] **Step 3: Create workspace root `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = ["crates/siphon-core", "crates/siphon-bench"]

[workspace.package]
edition = "2021"
license = "Apache-2.0"
version = "0.0.0"

[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
url = "2"
async-trait = "0.1"
thiserror = "2"
futures = "0.3"
clap = { version = "4", features = ["derive"] }
sysinfo = "0.32"
tempfile = "3"
```

- [ ] **Step 4: Create `siphon-core/Cargo.toml`**

```toml
[package]
name = "siphon-core"
edition.workspace = true
license.workspace = true
version.workspace = true

[dependencies]
tokio.workspace = true
reqwest.workspace = true
serde.workspace = true
serde_json.workspace = true
url.workspace = true
async-trait.workspace = true
thiserror.workspace = true
futures.workspace = true

[dev-dependencies]
tempfile.workspace = true
```

- [ ] **Step 5: Create `siphon-core/src/lib.rs` (empty re-export stub)**

```rust
pub mod error;
pub mod types;
pub mod url;
pub mod extractor;
pub mod router;
pub mod engines;
pub mod download;
pub mod ffmpeg;
```

- [ ] **Step 6: Create `siphon-bench/Cargo.toml`**

```toml
[package]
name = "siphon-bench"
edition.workspace = true
license.workspace = true
version.workspace = true

[dependencies]
siphon-core = { path = "../siphon-core" }
tokio.workspace = true
clap.workspace = true
sysinfo.workspace = true
serde_json.workspace = true
url.workspace = true
```

- [ ] **Step 7: Create `siphon-bench/src/main.rs` (stub)**

```rust
fn main() {
    println!("siphon-bench");
}
```

- [ ] **Step 8: Create `.gitignore`**

```
/target
**/*.rs.bk
/docs/reports/*.json
```

- [ ] **Step 9: Create `LICENSE`** — paste the standard Apache License 2.0 text (from https://www.apache.org/licenses/LICENSE-2.0.txt), copyright line `Copyright 2026 Siphon contributors`.

- [ ] **Step 10: Create `README.md` stub**

```markdown
# Siphon
Low-resource media downloader for Windows. Clean-room; Apache-2.0.
See docs/specs/2026-11-12-siphon-design.md.
```

- [ ] **Step 11: Create empty module files so it compiles**

Create each as an empty file (or `//! placeholder`): `error.rs`, `types.rs`, `url.rs`, `extractor.rs`, `router.rs`, `engines/mod.rs`, `download.rs`, `ffmpeg.rs`. Set `engines/mod.rs` to:
```rust
pub mod ytdlp;
pub mod reddit;
```
and create empty `engines/ytdlp.rs`, `engines/reddit.rs`.

- [ ] **Step 12: Build to verify scaffold**

Run: `cargo build`
Expected: compiles with no errors (warnings ok).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold siphon workspace and toolchain"
```

---

### Task 2: Core types + error

**Files:**
- Create: `siphon/crates/siphon-core/src/types.rs`, `siphon/crates/siphon-core/src/error.rs`
- Test: inline `#[cfg(test)]` in `types.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `Mode`, `Options` (with `Default`), `MediaKind`, `StreamKind`, `Stream`, `MediaItem`, `MediaPlan`, `SiphonError`. Later tasks use these exact names/fields.

- [ ] **Step 1: Write the failing test** (append to `types.rs`)

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p siphon-core types::`
Expected: FAIL — cannot find type `Options` / `Mode` / etc.

- [ ] **Step 3: Write minimal implementation** (top of `types.rs`)

```rust
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
```

- [ ] **Step 4: Write `error.rs`**

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SiphonError {
    #[error("extract failed: {0}")]
    Extract(String),
    #[error("unsupported link: {0}")]
    Unsupported(String),
    #[error("download failed: {0}")]
    Download(String),
    #[error("ffmpeg failed: {0}")]
    Ffmpeg(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, SiphonError>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p siphon-core types::`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add crates/siphon-core/src/types.rs crates/siphon-core/src/error.rs
git commit -m "feat(core): media plan types and error enum"
```

---

### Task 3: URL normalize + filename sanitize

**Files:**
- Create: `siphon/crates/siphon-core/src/url.rs`
- Test: inline `#[cfg(test)]` in `url.rs`

**Interfaces:**
- Consumes: `url::Url`.
- Produces: `normalize_url(input: &str) -> Result<Url>` and `sanitize_filename(name: &str, ext: &str) -> String`.

- [ ] **Step 1: Write the failing test**

```rust
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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p siphon-core url::`
Expected: FAIL — cannot find function `normalize_url`.

- [ ] **Step 3: Write minimal implementation**

```rust
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
        base.truncate(180);
    }
    format!("{base}.{ext}")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p siphon-core url::`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/siphon-core/src/url.rs
git commit -m "feat(core): url normalization and filename sanitization"
```

---

### Task 4: Extractor trait + router (hybrid routing)

**Files:**
- Create: `siphon/crates/siphon-core/src/extractor.rs`, `siphon/crates/siphon-core/src/router.rs`
- Test: `siphon/crates/siphon-core/tests/routing.rs`

**Interfaces:**
- Consumes: `types::{Options, MediaPlan}`, `error::Result`, `url::Url`.
- Produces: `#[async_trait] trait Extractor { fn id(&self) -> &'static str; fn matches(&self, url: &Url) -> bool; async fn extract(&self, url: &Url, opts: &Options) -> Result<MediaPlan>; }` and `ExtractorRouter::new(Vec<Box<dyn Extractor>>)` with `async fn resolve(&self, url: &Url, opts: &Options) -> Result<MediaPlan>`.

- [ ] **Step 1: Write the failing test** (`tests/routing.rs`)

```rust
use async_trait::async_trait;
use siphon_core::error::{Result, SiphonError};
use siphon_core::extractor::Extractor;
use siphon_core::router::ExtractorRouter;
use siphon_core::types::{MediaPlan, Options};
use url::Url;

struct Fake { id: &'static str, host: &'static str, fail: bool }

#[async_trait]
impl Extractor for Fake {
    fn id(&self) -> &'static str { self.id }
    fn matches(&self, url: &Url) -> bool { url.host_str() == Some(self.host) }
    async fn extract(&self, _url: &Url, _o: &Options) -> Result<MediaPlan> {
        if self.fail { return Err(SiphonError::Extract("boom".into())); }
        Ok(MediaPlan { service: self.id.into(), items: vec![] })
    }
}

struct CatchAll;
#[async_trait]
impl Extractor for CatchAll {
    fn id(&self) -> &'static str { "fallback" }
    fn matches(&self, _u: &Url) -> bool { true }
    async fn extract(&self, _u: &Url, _o: &Options) -> Result<MediaPlan> {
        Ok(MediaPlan { service: "fallback".into(), items: vec![] })
    }
}

fn u(s: &str) -> Url { Url::parse(s).unwrap() }

#[tokio::test]
async fn native_wins_over_fallback() {
    let r = ExtractorRouter::new(vec![
        Box::new(Fake { id: "reddit", host: "reddit.com", fail: false }),
        Box::new(CatchAll),
    ]);
    let plan = r.resolve(&u("https://reddit.com/x"), &Options::default()).await.unwrap();
    assert_eq!(plan.service, "reddit");
}

#[tokio::test]
async fn falls_back_when_native_fails() {
    let r = ExtractorRouter::new(vec![
        Box::new(Fake { id: "reddit", host: "reddit.com", fail: true }),
        Box::new(CatchAll),
    ]);
    let plan = r.resolve(&u("https://reddit.com/x"), &Options::default()).await.unwrap();
    assert_eq!(plan.service, "fallback");
}

#[tokio::test]
async fn fallback_used_for_unknown_host() {
    let r = ExtractorRouter::new(vec![
        Box::new(Fake { id: "reddit", host: "reddit.com", fail: false }),
        Box::new(CatchAll),
    ]);
    let plan = r.resolve(&u("https://example.com/x"), &Options::default()).await.unwrap();
    assert_eq!(plan.service, "fallback");
}

#[tokio::test]
async fn unsupported_when_no_match() {
    let r = ExtractorRouter::new(vec![Box::new(Fake { id: "reddit", host: "reddit.com", fail: false })]);
    let err = r.resolve(&u("https://example.com/x"), &Options::default()).await.unwrap_err();
    assert!(matches!(err, SiphonError::Unsupported(_)));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p siphon-core --test routing`
Expected: FAIL — unresolved imports `extractor` / `router`.

- [ ] **Step 3: Write `extractor.rs`**

```rust
use crate::error::Result;
use crate::types::{MediaPlan, Options};
use async_trait::async_trait;
use url::Url;

#[async_trait]
pub trait Extractor: Send + Sync {
    fn id(&self) -> &'static str;
    fn matches(&self, url: &Url) -> bool;
    async fn extract(&self, url: &Url, opts: &Options) -> Result<MediaPlan>;
}
```

- [ ] **Step 4: Write `router.rs`**

```rust
use crate::error::{Result, SiphonError};
use crate::extractor::Extractor;
use crate::types::{MediaPlan, Options};
use url::Url;

pub struct ExtractorRouter {
    extractors: Vec<Box<dyn Extractor>>,
}

impl ExtractorRouter {
    pub fn new(extractors: Vec<Box<dyn Extractor>>) -> Self {
        Self { extractors }
    }

    pub async fn resolve(&self, url: &Url, opts: &Options) -> Result<MediaPlan> {
        let mut last_err: Option<SiphonError> = None;
        for e in &self.extractors {
            if !e.matches(url) {
                continue;
            }
            match e.extract(url, opts).await {
                Ok(plan) => return Ok(plan),
                Err(err) => last_err = Some(err),
            }
        }
        Err(last_err.unwrap_or_else(|| SiphonError::Unsupported(url.to_string())))
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p siphon-core --test routing`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add crates/siphon-core/src/extractor.rs crates/siphon-core/src/router.rs crates/siphon-core/tests/routing.rs
git commit -m "feat(core): extractor trait and hybrid router with fallback"
```

---

### Task 5: yt-dlp adapter

**Files:**
- Create: `siphon/crates/siphon-core/src/engines/ytdlp.rs`, `siphon/crates/siphon-core/tests/fixtures/ytdlp_single.json`
- Test: `siphon/crates/siphon-core/tests/ytdlp_parse.rs`

**Interfaces:**
- Consumes: `Extractor`, `types::*`, `url::sanitize_filename`, `error::*`.
- Produces: `YtdlpExtractor` (implements `Extractor`, `id()=="yt-dlp"`, `matches()==true`), and `parse_ytdlp_json(v: &serde_json::Value, opts: &Options) -> Result<MediaPlan>` (pure, offline-testable).

- [ ] **Step 1: Create the fixture** (`tests/fixtures/ytdlp_single.json`) — a trimmed real-shaped yt-dlp single-video JSON:

```json
{
  "id": "abc123",
  "title": "Sample Clip",
  "ext": "mp4",
  "duration": 212.0,
  "formats": [
    { "format_id": "137", "url": "https://cdn/v1080", "vcodec": "avc1", "acodec": "none", "height": 1080, "ext": "mp4" },
    { "format_id": "136", "url": "https://cdn/v720", "vcodec": "avc1", "acodec": "none", "height": 720, "ext": "mp4" },
    { "format_id": "140", "url": "https://cdn/a128", "vcodec": "none", "acodec": "mp4a", "abr": 128, "ext": "m4a" },
    { "format_id": "18", "url": "https://cdn/combined360", "vcodec": "avc1", "acodec": "mp4a", "height": 360, "ext": "mp4" }
  ]
}
```

- [ ] **Step 2: Write the failing test** (`tests/ytdlp_parse.rs`)

```rust
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p siphon-core --test ytdlp_parse`
Expected: FAIL — unresolved `engines::ytdlp`.

- [ ] **Step 4: Write `engines/ytdlp.rs`**

```rust
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

fn combined(formats: &[Value], max_height: Option<u32>) -> Option<&Value> {
    formats
        .iter()
        .filter(|f| {
            f["vcodec"].as_str().unwrap_or("none") != "none"
                && f["acodec"].as_str().unwrap_or("none") != "none"
        })
        .filter(|f| match max_height {
            Some(h) => f["height"].as_u64().unwrap_or(0) <= h as u64,
            None => true,
        })
        .max_by_key(|f| f["height"].as_u64().unwrap_or(0))
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
            if let Some(c) = combined(&formats, opts.max_height) {
                (vec![stream_from(c, StreamKind::Video)], false, c["ext"].as_str().unwrap_or("mp4").to_string())
            } else {
                let vid = best_video(&formats, opts.max_height)
                    .ok_or_else(|| SiphonError::Extract("no video format".into()))?;
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p siphon-core --test ytdlp_parse`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add crates/siphon-core/src/engines/ytdlp.rs crates/siphon-core/tests/ytdlp_parse.rs crates/siphon-core/tests/fixtures/ytdlp_single.json
git commit -m "feat(core): yt-dlp adapter with format selection"
```

---

### Task 6: Native Reddit extractor (proof of hybrid)

**Files:**
- Create: `siphon/crates/siphon-core/src/engines/reddit.rs`, `siphon/crates/siphon-core/tests/fixtures/reddit_post.json`
- Test: `siphon/crates/siphon-core/tests/reddit_parse.rs`

**Interfaces:**
- Consumes: `Extractor`, `types::*`, `url::sanitize_filename`, `error::*`.
- Produces: `RedditExtractor` (`id()=="reddit"`, matches reddit.com/redd.it) and `parse_reddit_json(v: &Value) -> Result<MediaPlan>`.

- [ ] **Step 1: Create the fixture** (`tests/fixtures/reddit_post.json`) — trimmed Reddit listing shape:

```json
[
  {
    "data": {
      "children": [
        {
          "data": {
            "title": "Reddit Clip",
            "secure_media": {
              "reddit_video": {
                "fallback_url": "https://v.redd.it/abc/DASH_720.mp4?source=fallback",
                "duration": 30.0,
                "is_gif": false
              }
            }
          }
        }
      ]
    }
  }
]
```

- [ ] **Step 2: Write the failing test** (`tests/reddit_parse.rs`)

```rust
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p siphon-core --test reddit_parse`
Expected: FAIL — unresolved `engines::reddit`.

- [ ] **Step 4: Write `engines/reddit.rs`**

```rust
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p siphon-core --test reddit_parse`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add crates/siphon-core/src/engines/reddit.rs crates/siphon-core/tests/reddit_parse.rs crates/siphon-core/tests/fixtures/reddit_post.json
git commit -m "feat(core): native reddit extractor proving hybrid routing"
```

---

### Task 7: Segmented parallel downloader

**Files:**
- Create: `siphon/crates/siphon-core/src/download.rs`
- Test: `siphon/crates/siphon-core/tests/download_local.rs`

**Interfaces:**
- Consumes: `error::*`, `reqwest::Client`.
- Produces: `split_ranges(total: u64, n: usize) -> Vec<(u64, u64)>` (inclusive byte ranges) and `async fn download_segmented(client: &reqwest::Client, url: &str, headers: &[(String, String)], dest: &std::path::Path, connections: usize) -> Result<u64>` (returns bytes written).

- [ ] **Step 1: Write the failing test** (`tests/download_local.rs`) — includes a minimal local Range-supporting HTTP server:

```rust
use siphon_core::download::{download_segmented, split_ranges};
use std::io::{Read, Write};
use std::net::TcpListener;

#[test]
fn splits_into_contiguous_inclusive_ranges() {
    let r = split_ranges(100, 4);
    assert_eq!(r, vec![(0, 24), (25, 49), (50, 74), (75, 99)]);
    assert_eq!(split_ranges(10, 1), vec![(0, 9)]);
    assert_eq!(split_ranges(3, 8).len(), 3); // never more parts than bytes
}

fn spawn_server(body: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut s = stream.unwrap();
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let total = body.len();
            let range = req.lines().find(|l| l.to_ascii_lowercase().starts_with("range:"));
            let (start, end, status) = if let Some(r) = range {
                let spec = r.split('=').nth(1).unwrap().trim();
                let mut parts = spec.split('-');
                let start: usize = parts.next().unwrap().parse().unwrap();
                let end: usize = parts.next().unwrap_or("").parse().unwrap_or(total - 1);
                (start, end.min(total - 1), "206 Partial Content")
            } else {
                (0, total - 1, "200 OK")
            };
            let slice = &body[start..=end];
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\nConnection: close\r\n\r\n",
                slice.len()
            );
            let _ = s.write_all(head.as_bytes());
            let _ = s.write_all(slice);
            let _ = s.flush();
        }
    });
    (format!("http://{addr}/file"), handle)
}

#[tokio::test]
async fn downloads_full_file_via_segments() {
    let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    let (url, _h) = spawn_server(body.clone());
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out.bin");
    let client = reqwest::Client::new();
    let n = download_segmented(&client, &url, &[], &dest, 8).await.unwrap();
    assert_eq!(n as usize, body.len());
    let got = std::fs::read(&dest).unwrap();
    assert_eq!(got, body);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p siphon-core --test download_local`
Expected: FAIL — unresolved `download`.

- [ ] **Step 3: Write `download.rs`**

```rust
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
```

Note: the single-stream fallback writes from offset 0; concurrent segment writes use positioned seeks so they don't collide. This is M0-grade (full crash-resume is M2).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p siphon-core --test download_local`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/siphon-core/src/download.rs crates/siphon-core/tests/download_local.rs
git commit -m "feat(core): segmented parallel downloader with range fallback"
```

---

### Task 8: ffmpeg merge

**Files:**
- Create: `siphon/crates/siphon-core/src/ffmpeg.rs`
- Test: `siphon/crates/siphon-core/tests/ffmpeg_merge.rs`

**Interfaces:**
- Consumes: `error::*`.
- Produces: `merge_args(video: &Path, audio: &Path, out: &Path) -> Vec<String>` and `async fn merge(video: &Path, audio: &Path, out: &Path) -> Result<()>`.

- [ ] **Step 1: Write the failing test** (`tests/ffmpeg_merge.rs`)

```rust
use siphon_core::ffmpeg::{merge, merge_args};
use std::path::Path;

#[test]
fn argv_uses_copy_and_faststart_no_shell() {
    let args = merge_args(Path::new("v.mp4"), Path::new("a.m4a"), Path::new("out.mp4"));
    assert_eq!(
        args,
        vec!["-y", "-i", "v.mp4", "-i", "a.m4a", "-c", "copy", "-movflags", "+faststart", "out.mp4"]
    );
    assert!(!args.iter().any(|a| a.contains(';') || a.contains("&&")));
}

#[tokio::test]
async fn merges_generated_streams_into_playable_mp4() {
    let dir = tempfile::tempdir().unwrap();
    let v = dir.path().join("v.mp4");
    let a = dir.path().join("a.m4a");
    let out = dir.path().join("out.mp4");

    // Generate 2s of color video and a sine tone with ffmpeg itself (offline).
    let gen_v = tokio::process::Command::new("ffmpeg")
        .args(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", v.to_str().unwrap()])
        .output().await.unwrap();
    assert!(gen_v.status.success(), "video gen failed: {}", String::from_utf8_lossy(&gen_v.stderr));
    let gen_a = tokio::process::Command::new("ffmpeg")
        .args(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
               "-c:a", "aac", a.to_str().unwrap()])
        .output().await.unwrap();
    assert!(gen_a.status.success(), "audio gen failed: {}", String::from_utf8_lossy(&gen_a.stderr));

    merge(&v, &a, &out).await.unwrap();
    let meta = std::fs::metadata(&out).unwrap();
    assert!(meta.len() > 1000);
}
```

Note: this test needs an ffmpeg with libx264/aac. If the system ffmpeg lacks libx264, change `-c:v libx264` to `-c:v mpeg4` for the test only (the merge under test uses `-c copy`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p siphon-core --test ffmpeg_merge`
Expected: FAIL — unresolved `ffmpeg`.

- [ ] **Step 3: Write `ffmpeg.rs`**

```rust
use crate::error::{Result, SiphonError};
use std::path::Path;

pub fn merge_args(video: &Path, audio: &Path, out: &Path) -> Vec<String> {
    vec![
        "-y".into(),
        "-i".into(), video.to_string_lossy().into_owned(),
        "-i".into(), audio.to_string_lossy().into_owned(),
        "-c".into(), "copy".into(),
        "-movflags".into(), "+faststart".into(),
        out.to_string_lossy().into_owned(),
    ]
}

pub async fn merge(video: &Path, audio: &Path, out: &Path) -> Result<()> {
    let args = merge_args(video, audio, out);
    let output = tokio::process::Command::new("ffmpeg")
        .args(&args)
        .output()
        .await
        .map_err(|e| SiphonError::Ffmpeg(format!("spawn ffmpeg: {e}")))?;
    if !output.status.success() {
        return Err(SiphonError::Ffmpeg(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p siphon-core --test ffmpeg_merge`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/siphon-core/src/ffmpeg.rs crates/siphon-core/tests/ffmpeg_merge.rs
git commit -m "feat(core): ffmpeg merge orchestration via argv"
```

---

### Task 9: End-to-end CLI harness

**Files:**
- Create: `siphon/crates/siphon-bench/src/main.rs` (replace stub)
- Test: `siphon/crates/siphon-core/tests/net_download.rs` (network-gated)

**Interfaces:**
- Consumes: `ExtractorRouter`, `RedditExtractor`, `YtdlpExtractor`, `download_segmented`, `merge`, `normalize_url`, `Options`.
- Produces: `siphon-bench run <URL> [--out DIR] [--connections N] [--audio]` that extracts → downloads → merges → saves, printing the output path and elapsed ms. Also `async fn run_once(url: &str, out: &Path, connections: usize, opts: &Options) -> Result<RunStats>` reusable by the bench (Task 10), where `RunStats { bytes: u64, elapsed_ms: u128, output: PathBuf, service: String }`.

- [ ] **Step 1: Write the failing network-gated test** (`tests/net_download.rs`)

```rust
use siphon_core::types::Options;

#[tokio::test]
async fn end_to_end_youtube_small_clip() {
    if std::env::var("SIPHON_NET").ok().as_deref() != Some("1") {
        eprintln!("skipping network test (set SIPHON_NET=1)");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    // A short, stable, public-domain sample. Replace with a known-good short clip if needed.
    let stats = siphon_bench::run_once(
        "https://www.youtube.com/watch?v=jNQXAC9IVRw", // "Me at the zoo" (19s, public)
        dir.path(),
        8,
        &Options::default(),
    ).await.unwrap();
    assert!(stats.bytes > 10_000);
    assert!(stats.output.exists());
}
```

Note: `siphon-bench` must expose `run_once` as a library. Add `siphon/crates/siphon-bench/src/lib.rs` with `pub mod runner;` and move logic into `runner.rs`; `main.rs` calls it. Add `siphon-core` dev-dependency on `siphon-bench` is circular — instead put this test in `siphon-bench/tests/net_download.rs` (a crate can integration-test its own lib). Create `siphon/crates/siphon-bench/tests/net_download.rs` with the same body, and add `tempfile` to `siphon-bench` dev-dependencies.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p siphon-bench --test net_download`
Expected: FAIL — `run_once` not found (and skipped unless `SIPHON_NET=1`).

- [ ] **Step 3: Write `siphon-bench/src/runner.rs`**

```rust
use siphon_core::download::download_segmented;
use siphon_core::engines::reddit::RedditExtractor;
use siphon_core::engines::ytdlp::YtdlpExtractor;
use siphon_core::error::{Result, SiphonError};
use siphon_core::extractor::Extractor;
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
    }

    Ok(RunStats { bytes, elapsed_ms: start.elapsed().as_millis(), output: final_path, service })
}
```

- [ ] **Step 4: Write `siphon-bench/src/lib.rs`**

```rust
pub mod runner;
pub use runner::{router, run_once, RunStats};
```

- [ ] **Step 5: Write `siphon-bench/src/main.rs`**

```rust
use clap::{Parser, Subcommand};
use siphon_bench::run_once;
use siphon_core::types::{Mode, Options};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "siphon-bench", about = "Siphon M0 feasibility harness")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Download one URL end-to-end and print stats.
    Run {
        url: String,
        #[arg(long, default_value = "./out")]
        out: PathBuf,
        #[arg(long, default_value_t = 8)]
        connections: usize,
        #[arg(long)]
        audio: bool,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Run { url, out, connections, audio } => {
            let mut opts = Options::default();
            if audio { opts.mode = Mode::Audio; }
            match run_once(&url, &out, connections, &opts).await {
                Ok(s) => println!(
                    "ok service={} bytes={} elapsed_ms={} file={}",
                    s.service, s.bytes, s.elapsed_ms, s.output.display()
                ),
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            }
        }
    }
}
```

- [ ] **Step 6: Add tempfile dev-dep + reqwest dep to `siphon-bench/Cargo.toml`**

Add under `[dependencies]`: `reqwest.workspace = true`. Add:
```toml
[dev-dependencies]
tempfile.workspace = true
tokio.workspace = true
```

- [ ] **Step 7: Build and run offline unit path**

Run: `cargo build`
Expected: compiles.
Run: `cargo test -p siphon-bench --test net_download`
Expected: PASS (skipped) without `SIPHON_NET=1`.

- [ ] **Step 8: Run the real end-to-end test (network)**

Run: `SIPHON_NET=1 cargo test -p siphon-bench --test net_download -- --nocapture`
Expected: PASS — a real file downloaded and merged. If the sample URL is unavailable, substitute another short public clip and note it.

- [ ] **Step 9: Commit**

```bash
git add crates/siphon-bench/src crates/siphon-bench/Cargo.toml crates/siphon-bench/tests/net_download.rs
git commit -m "feat(bench): end-to-end run harness wiring router, download, merge"
```

---

### Task 10: Resource measurement + go/no-go report

**Files:**
- Create: `siphon/crates/siphon-bench/src/measure.rs`, modify `siphon/crates/siphon-bench/src/main.rs` (add `Bench` subcommand), `siphon/crates/siphon-bench/src/lib.rs` (export measure)
- Create (generated): `siphon/docs/reports/m0-report.md`

**Interfaces:**
- Consumes: `run_once`, `RunStats`, `sysinfo`.
- Produces: `Sampler` that records peak working-set bytes and CPU%; `bench` subcommand that runs a fixed sample set, measures, and writes `docs/reports/m0-report.md` comparing to spec targets.

- [ ] **Step 1: Write the failing test** (inline in `measure.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throughput_bytes_per_sec() {
        // 1_000_000 bytes in 500 ms => 2_000_000 B/s
        let t = throughput(1_000_000, 500);
        assert!((t - 2_000_000.0).abs() < 1.0);
    }

    #[test]
    fn throughput_zero_time_is_safe() {
        assert_eq!(throughput(100, 0), 0.0);
    }

    #[test]
    fn mb_conversion() {
        assert!((bytes_to_mb(104_857_600) - 100.0).abs() < 0.001);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p siphon-bench measure::`
Expected: FAIL — cannot find function `throughput`.

- [ ] **Step 3: Write `measure.rs`**

```rust
use sysinfo::{Pid, ProcessesToUpdate, System};

pub fn bytes_to_mb(b: u64) -> f64 { b as f64 / 1_048_576.0 }

pub fn throughput(bytes: u64, elapsed_ms: u128) -> f64 {
    if elapsed_ms == 0 { return 0.0; }
    bytes as f64 / (elapsed_ms as f64 / 1000.0)
}

pub struct Sampler {
    sys: System,
    pid: Pid,
    pub peak_bytes: u64,
    pub peak_cpu: f32,
}

impl Sampler {
    pub fn new() -> Self {
        let pid = Pid::from_u32(std::process::id());
        Self { sys: System::new(), pid, peak_bytes: 0, peak_cpu: 0.0 }
    }

    pub fn sample(&mut self) {
        self.sys.refresh_processes(ProcessesToUpdate::Some(&[self.pid]), true);
        if let Some(p) = self.sys.process(self.pid) {
            self.peak_bytes = self.peak_bytes.max(p.memory());
            self.peak_cpu = self.peak_cpu.max(p.cpu_usage());
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p siphon-bench measure::`
Expected: 3 passed.

- [ ] **Step 5: Add `Bench` subcommand to `main.rs`**

Add to `Cmd` enum:
```rust
    /// Run the fixed sample set, measure resources, write docs/reports/m0-report.md.
    Bench {
        #[arg(long, default_value = "./out")]
        out: PathBuf,
        #[arg(long, default_value_t = 8)]
        connections: usize,
    },
```
Add the match arm (and `mod measure;` via lib). In `main.rs` add `use siphon_bench::measure::{Sampler, bytes_to_mb, throughput};` and:
```rust
        Cmd::Bench { out, connections } => {
            let samples: &[(&str, &str)] = &[
                ("youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw"),
                // Add 2-3 more stable public links (tiktok/reddit) before final run.
            ];
            let mut report = String::from("# Siphon M0 report\n\n");
            report.push_str("| service | bytes | elapsed_ms | MB/s | peak_RAM_MB | peak_CPU% |\n");
            report.push_str("|---|---|---|---|---|---|\n");
            let opts = siphon_core::types::Options::default();
            for (name, url) in samples {
                let mut sampler = Sampler::new();
                sampler.sample();
                let handle = tokio::spawn(async move {
                    // sampling happens on the main task below; placeholder removed in impl
                });
                let _ = handle.await;
                // Run with periodic sampling:
                let mut sampler = Sampler::new();
                let run = run_once(url, &out, connections, &opts);
                tokio::pin!(run);
                let stats = loop {
                    tokio::select! {
                        r = &mut run => break r,
                        _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => sampler.sample(),
                    }
                };
                match stats {
                    Ok(s) => {
                        sampler.sample();
                        report.push_str(&format!(
                            "| {} | {} | {} | {:.2} | {:.1} | {:.1} |\n",
                            name, s.bytes, s.elapsed_ms,
                            throughput(s.bytes, s.elapsed_ms) / 1_048_576.0,
                            bytes_to_mb(sampler.peak_bytes), sampler.peak_cpu
                        ));
                    }
                    Err(e) => report.push_str(&format!("| {name} | ERROR | {e} | | | |\n")),
                }
            }
            report.push_str("\nTargets (spec §9): active RAM ≤ 150 MB; throughput ≥ cobalt (target 2–5x large files).\n");
            std::fs::create_dir_all("docs/reports").ok();
            std::fs::write("docs/reports/m0-report.md", &report).unwrap();
            println!("{report}");
        }
```
Remove the unused first `sampler`/`handle` placeholder lines above before committing (they are illustrative; the final code uses only the `tokio::select!` sampling loop). Export `pub mod measure;` from `lib.rs`.

- [ ] **Step 6: Build**

Run: `cargo build`
Expected: compiles.

- [ ] **Step 7: Run the benchmark (network) and capture the report**

Run: `cargo run -p siphon-bench -- bench --out ./out`
Expected: prints a table and writes `docs/reports/m0-report.md` with real peak RAM, CPU, throughput per sample.

- [ ] **Step 8: Go/no-go assessment**

Read `docs/reports/m0-report.md`. Compare peak RAM to ≤150 MB and throughput to a cobalt baseline (download the same link via a cobalt instance or note single-stream speed). Write a short `## Verdict` section in the report: GO if targets met (or close with a clear mitigation), NO-GO with the specific gap if not. This verdict gates M1.

- [ ] **Step 9: Commit**

```bash
git add crates/siphon-bench/src docs/reports/m0-report.md
git commit -m "feat(bench): resource measurement and m0 go/no-go report"
```

---

## Self-Review

**1. Spec coverage (M0 scope):**
- Hybrid engine + Extractor trait + router → Tasks 4, 5, 6. ✅
- yt-dlp universal fallback → Task 5. ✅
- Native extractor proof (Reddit) → Task 6. ✅
- Segmented multi-connection download (speed claim) → Task 7. ✅
- ffmpeg merge → Task 8. ✅
- End-to-end local download (YouTube works) → Task 9. ✅
- Resource targets measured (active RAM, startup via elapsed, throughput) → Task 10. ✅
- Clean-room / Apache-2.0 / no-shell-injection / sanitize / no-telemetry → Global Constraints + Tasks 1, 3, 5, 8. ✅
- Idle RAM / installer / UI / rabbit / dark-matte → explicitly M1+ (non-goals for M0). ✅ (covered by later plans)
- Full crash-resume, queue, presets, subtitles → M2/M3 (noted as out of M0 scope). ✅

**2. Placeholder scan:** Task 10 Step 5 contains an illustrative unused `sampler`/`handle` block that the step explicitly instructs to remove before committing; the final code (the `tokio::select!` loop) is complete. No TBD/TODO remain. All code steps include real code.

**3. Type consistency:** `MediaPlan`, `MediaItem`, `Stream`, `StreamKind`, `Options`, `Mode`, `SiphonError`, `Extractor`, `ExtractorRouter::new/resolve`, `parse_ytdlp_json`, `parse_reddit_json`, `split_ranges`, `download_segmented`, `merge_args`, `merge`, `run_once`, `RunStats`, `Sampler`, `throughput`, `bytes_to_mb` are used consistently across tasks. `RunStats` fields (`bytes`, `elapsed_ms`, `output`, `service`) match between Tasks 9 and 10. ✅

## Notes for the executor
- This is Windows + Git Bash. Use forward slashes in paths. `cargo`, `git`, `ffmpeg`, `winget` are on PATH; install `yt-dlp` in Task 1 (needs user approval).
- Network tests are gated by `SIPHON_NET=1`; offline `cargo test` must stay green.
- If a sample URL is dead, swap in another short public clip and record the substitution in the report.
- Core (`siphon-core`) is production foundation reused in M1 — do not treat it as throwaway. Only the measurement scaffolding is spike-grade.