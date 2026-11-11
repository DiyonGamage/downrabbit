# Siphon — design spec

> Working codename: **Siphon** (rename anytime). A low-resource, no-nonsense media
> downloader for Windows that beats cobalt on footprint, speed, coverage, and UX.
> Status: design for review. Date: 2026-11-12.

## 1. Summary

Siphon is a native-feeling Windows desktop app: paste a link, get the file. It is a
clean-room recreation of the *idea* of [cobalt](https://github.com/imputnet/cobalt)
(not its code), rebuilt to be roughly **10x lighter** and better on every axis that
matters to a daily user.

Decisions locked with the user:
- **Engine: Hybrid.** Native Rust extractors for top sites + `yt-dlp` universal fallback.
- **Shell/UI: Tauri 2** (Rust core + Windows WebView2 + minimal web UI).
- **License: open source**, clean-room. Recommended **Apache-2.0** for our code.
- **Name: Siphon** (kept). **Art direction: dark matte, terminal-feel, super-polished /
  artistic / simple, with a cute rabbit mascot and stateful animations** (section 8).

### Why we can beat cobalt (evidence)
From source review (v11.7.1) and a REA live capture of cobalt.tools
(evidence id `ev_7e845b105542a5dd035a9ec6b009025f811504c5ba6d4384f5b8a7b8e49be375`):
- cobalt's public API returned a service list **without YouTube**, and the web UI
  stalled at a Cloudflare **Turnstile** "checking if you're not a robot" gate
  (`failure_retry` in headless capture); the download never ran.
- cobalt streams every file through a server **proxy tunnel** (single connection,
  double bandwidth) and now runs **WASM ffmpeg in the browser tab** for remuxing
  (large RAM/CPU cost).
- Self-hosting cobalt means Node + optional Redis + ffmpeg + Docker (heavy, ops burden).

Siphon removes all of that: extraction and download happen **locally, on the user's
own IP/session**, with **multi-connection direct downloads**, no bot gate, no rate
limit, no proxy hop, and heavy tools spawned only during a job.

## 2. Goals & success criteria

Measurable targets (validated in milestone M0 before UI work):
- **Idle RAM ≤ 40 MB**, idle CPU ~0%, cold startup **< 300 ms**.
- **Active-job RAM ≤ 150 MB** worst case (yt-dlp + ffmpeg transient), ≤ 80 MB with a
  native extractor and no merge.
- **Installer ≤ ~12 MB** (ffmpeg bundled separately or on first use).
- **Download throughput ≥ cobalt** on the same link; target 2–5x on large files via
  segmented parallel connections.
- **Day-one coverage ≥ cobalt's 22 services** via yt-dlp fallback (actually 1000+).
- **YouTube works** (cobalt public currently drops it).
- Zero telemetry, no account, fully offline UI.

## 3. Non-goals (scope boundaries)

- Not a piracy tool: only free, publicly accessible content (same ethics as cobalt).
- No DRM circumvention (no Widevine/Netflix/etc.).
- No server/cloud component, no user accounts, no social features.
- No built-in media player/editor in v1 (open the file in the OS default app).
- Not cross-platform in v1: Windows 10/11 x64 first. (Tauri keeps macOS/Linux cheap later.)
- No GUI for advanced yt-dlp flags in v1; presets cover the common cases.

## 4. Architecture

Five units, each independently testable:

```
┌────────────────────────────────────────────────────────────┐
│ UI (WebView2: minimal TS + CSS, no framework required)      │
│  paste box · presets · live queue · history · settings      │
└───────────────▲───────────────────────────┬────────────────┘
                │ Tauri IPC (commands/events)│
┌───────────────┴───────────────────────────▼────────────────┐
│ Shell (Rust, Tauri 2)                                       │
│  window · tray · global hotkey · clipboard watch ·          │
│  single-instance · auto-update · drag&drop                  │
├─────────────────────────────────────────────────────────────┤
│ Core (Rust library, no UI deps)                             │
│  JobQueue (SQLite) · DownloadManager (segmented/resumable) ·│
│  ExtractorRouter · FfmpegOrchestrator · History · Settings  │
├─────────────────────────────────────────────────────────────┤
│ Engine (Hybrid)                                             │
│  NativeExtractor[] (Rust, per-site)  ──fallback──► yt-dlp   │
│  ffmpeg (LGPL build, spawned on demand)                     │
├─────────────────────────────────────────────────────────────┤
│ Data: SQLite (jobs, history, settings) · local files only   │
└─────────────────────────────────────────────────────────────┘
```

- **Shell** owns OS integration only; it calls Core and forwards events to the UI.
- **Core** is a plain Rust library with no Tauri dependency, so it can be unit-tested
  and benchmarked headless (this is what M0 measures).
- **Engine** is behind the `Extractor` trait (section 5); Core never knows whether a
  plan came from native Rust or yt-dlp.
- **UI** is a thin client over IPC; it holds no business logic.

## 5. The Extractor abstraction (heart of the hybrid)

A single trait makes native and yt-dlp sources interchangeable:

```rust
#[async_trait]
trait Extractor {
    fn id(&self) -> &'static str;                 // "youtube", "tiktok", "yt-dlp"
    fn matches(&self, url: &Url) -> bool;         // cheap URL/host test
    async fn extract(&self, url: &Url, opts: &Options) -> Result<MediaPlan>;
}
```

`MediaPlan` is the uniform contract the DownloadManager consumes:
- `items: Vec<MediaItem>` — one per selectable result (picker for slideshows/playlists).
- each item: `kind` (video/audio/image/gif), `streams` (video URL, audio URL, subtitle
  URLs, required HTTP headers, cookies), `container/codec`, `needs_merge: bool`,
  `filename`, `metadata` (title, artist, album, date, thumbnail), `duration`.
- `Options`: mode (auto/audio/mute), max video quality, audio format/bitrate,
  subtitle language, filename style, metadata on/off.

**Routing:** `ExtractorRouter` holds native extractors in priority order, then the
yt-dlp fallback last. First `matches()` wins; on native `extract()` error it may fall
back to yt-dlp (configurable). This means:
- Day 1: only the yt-dlp extractor exists → full coverage immediately.
- Over time: add native extractors that *shadow* yt-dlp for their hosts, reducing
  per-job memory/CPU and increasing speed, with zero change to Core or UI.

**Native extractor rollout order (easiest/highest-value first):**
1. Reddit, SoundCloud (simple JSON APIs — quick wins).
2. TikTok (signed API, doable).
3. Instagram, X/Twitter (GraphQL, often need user cookies).
4. YouTube **last** (hardest: signature deciphering, PO tokens, throttling). YouTube
   stays on yt-dlp until a native extractor is proven; this is an explicit risk, not a
   blocker.

**yt-dlp adapter:** spawn `yt-dlp --dump-single-json --no-download <url>` (plus option
flags), parse JSON into `MediaPlan`. For actual media bytes, prefer direct stream URLs
from the plan so our segmented downloader handles transfer; fall back to `yt-dlp -o`
for sites that require its downloader. yt-dlp runs only during a job, then exits.

## 6. Download pipeline

1. **Resolve:** URL normalize → Router.extract → MediaPlan.
2. **Select:** apply preset/options; if multiple items, show picker (or auto-queue all
   for playlists/batch).
3. **Transfer:** DownloadManager fetches streams with **N parallel range requests**
   (default 8, configurable), resumable via on-disk part state, with retry/backoff and
   per-host politeness. Direct CDN, no proxy.
4. **Process (only if needed):** FfmpegOrchestrator spawns ffmpeg to merge video+audio,
   remux (lossless, no re-encode when possible), extract/convert audio, embed metadata
   and subtitles, crop cover art. Killed on completion.
5. **Finalize:** atomic move into the target folder with the generated filename; write
   History row; notify UI + optional OS toast.

Pause/resume/cancel/retry are first-class queue operations. Concurrency is capped
(default 2 simultaneous jobs) to stay light.

## 7. Feature set (where we beat cobalt)

- Paste / **drag&drop** / **clipboard watch** / **global hotkey** → instant capture.
- **Batch & playlists:** paste many links or a playlist/channel; queue them all.
- **Presets:** "Best video", "1080p MP4", "Audio MP3 320", "Mute video", per-service
  defaults; one-click mode switch (auto/audio/mute, matching cobalt's mental model).
- **Speed:** multi-connection direct downloads; no proxy hop.
- **Coverage:** 1000+ sites via yt-dlp; native speed for top sites; **YouTube works**.
- **Subtitles, metadata, thumbnails, chapters** (yt-dlp strengths) embedded on request.
- **History:** local, searchable, re-download, open file/folder.
- **No friction:** no bot check, no rate limit, no account, no queue server.
- **Privacy:** zero telemetry; network only for downloads + optional update check.
- **Light & fast:** tray-resident, <300 ms startup, tiny installer, portable mode.
- **Lossless remux** when codecs allow (fast, no quality loss).

## 8. UX / visual direction

**Art direction (user-confirmed): super-polished, artistic, simple. Dark matte finish
with a terminal feel. A cute rabbit mascot woven through the whole experience.**

Visual language:
- **Dark matte** surfaces — near-black, flat/matte (no glossy gradients, no glass);
  depth from subtle elevation, not shine.
- **Terminal feel** — monospace type for labels/data/progress, a single phosphor accent
  (green or amber; **no blue**), crisp 1px hairlines, a blinking caret in the paste
  field, command-line-style status lines. Calm, precise, "hacker-clean" but friendly.
- **Simple & artistic** — one primary screen, generous whitespace, restrained palette
  (matte black + one phosphor accent + neutral grays), award-caliber spacing and type.
- **Cute rabbit mascot** — the brand character (app name stays **Siphon**; the rabbit is
  the mascot). A small, friendly rabbit is the logo and a stateful companion.

Rabbit animation states (short, eased, tied to real state — no infinite ambient loops):
- **Idle:** gentle blink / occasional ear twitch beside the paste field.
- **Link detected:** ears perk up, looks at the input.
- **Downloading:** rabbit hops along the progress bar; pace ties to throughput.
- **Merging/processing:** brief "working" gesture.
- **Success:** happy hop + ear wiggle, then settles.
- **Error:** ears droop, sympathetic expression, paired with a clear message.
- **Empty state:** rabbit invites you to paste a link.
A reduced-motion setting disables non-essential animation.

Layout:
- Large central paste field with a single primary action and the rabbit beside it.
- Compact mode/quality preset row (auto · audio · mute + quality).
- Live queue below (progress, speed, pause/cancel); history in a secondary view.
- Settings drawer: download folder, concurrency, connections, presets, hotkey,
  clipboard watch, theme, update channel, reduced motion.
- Tray icon (rabbit) for quick capture; window can hide to tray.

A visual mockup pass (dark-matte terminal look + rabbit mascot + motion) happens during
M1, offered just-in-time.

## 9. Resource budget (targets, validated in M0)

| State | RAM target | CPU | Notes |
|---|---|---|---|
| Idle (tray) | ≤ 40 MB | ~0% | WebView2 + Rust core |
| Active, native extractor, no merge | ≤ 80 MB | low | Rust HTTP + buffers |
| Active, yt-dlp fallback | ≤ 120 MB | moderate | + transient Python proc |
| Active, ffmpeg merge | ≤ 150 MB | burst | + transient ffmpeg, killed after |
| Cold startup | — | — | < 300 ms |
| Installer | — | — | ≤ ~12 MB (+ffmpeg optional) |

M0 builds a headless Rust harness (Core + Engine, no UI) and records RAM/CPU/startup
and throughput on a fixed set of sample links, comparing against these numbers and a
cobalt baseline. If targets miss, we adjust before building UI.

## 10. Licensing & clean-room policy

- **Our code: Apache-2.0** (recommended; user may choose MIT/GPL). Open source.
- **Clean-room:** no cobalt source copied. We use only its *documented API shape* and
  *observed behavior* (REA capture) as a behavioral blueprint. All extractors, Core,
  Shell, and UI are written fresh.
- **yt-dlp:** Unlicense (public-domain-equivalent) — safe to bundle and ship.
- **ffmpeg:** use an **LGPL** build (no GPL-only components like libx264 unless we
  comply); spawn as a separate process. Document the build provenance and offer source
  per LGPL. Prefer system ffmpeg if present, else bundled.
- **WebView2:** evergreen runtime, present on Windows 10/11; installer bootstraps if absent.
- No AGPL/CC-BY-NC-SA code enters the repo. Add a license/notice file for bundled deps.

## 11. Data model (SQLite)

- `jobs(id, url, service, status, preset_json, progress, bytes_total, bytes_done,
  error, created_at, updated_at)` — live queue, persisted for resume.
- `history(id, url, service, title, filename, path, kind, bytes, metadata_json,
  downloaded_at)` — completed items, searchable.
- `settings(key, value_json)` — folder, concurrency, connections, hotkey, theme, etc.
- `parts(job_id, stream_id, range_start, range_end, done)` — resumable transfer state.
Single local DB file under the app data dir; no cloud.

## 12. Error handling & edge cases

- Network failure → retry with backoff; resumable parts survive app restart.
- Extractor failure → optional yt-dlp fallback; clear, human error message + error code.
- Unsupported/DRM/private link → explicit "can't download this" with reason (no crash).
- ffmpeg missing/fails → actionable message; offer to fetch the bundled build.
- Rate-limited host (e.g., YouTube 429) → backoff, optional user cookies import.
- Disk full / permission denied → pre-flight space check, clear error, no partial file.
- Invalid/unsafe filenames → sanitize; path traversal guarded.
- Single-instance: second launch focuses existing window / forwards the URL.
- Concurrency cap + per-host politeness to avoid hammering services.

## 13. Testing & validation

- **Core unit tests:** URL routing, MediaPlan mapping, filename sanitization, queue
  state machine, resume logic.
- **Engine integration tests:** real downloads against a small set of stable public
  sample links per supported service; assert file integrity (size/duration/hash).
- **Resource benchmarks (M0):** headless harness measures RAM/CPU/startup/throughput
  vs section 9 targets and a cobalt baseline; tracked over time.
- **UI golden path:** paste→download→history; batch; pause/resume; hotkey; clipboard;
  drag&drop; settings persistence. Manual + automated where practical.
- **Security:** no command injection (yt-dlp/ffmpeg args passed as argv, never shell
  strings), path traversal guards, no telemetry.

## 14. Milestones / decomposition

- **M0 — Feasibility spike (throwaway harness):** Rust Core + yt-dlp + ffmpeg download
  YouTube/TikTok/Reddit headless; measure RAM/CPU/startup/speed; confirm targets and
  hybrid routing. Output: a go/no-go with real numbers.
- **M1 — Shell + single download:** Tauri 2 app, minimal UI, one link end-to-end
  (yt-dlp engine), tray, settings folder. Visual mockup pass here.
- **M2 — Queue & capture:** batch/playlists, presets, pause/resume/retry, clipboard
  watch, global hotkey, drag&drop, history.
- **M3 — Depth & ship:** subtitles/metadata/thumbnails, lossless remux, auto-update,
  installer + portable mode, error/edge hardening.
- **M4 — Native extractors & polish:** add native Rust extractors in rollout order
  (Reddit/SoundCloud → TikTok → Instagram/X → YouTube), perf hardening, design polish.

Each milestone is independently shippable; M0 gates the rest.

## 15. Risks & mitigations

- **Native YouTube is hard** (PO tokens, signatures, throttling). → Keep yt-dlp for
  YouTube until native is proven; hybrid means no coverage loss.
- **Sites change frequently.** → yt-dlp fallback absorbs breakage; native extractors
  are isolated and can be disabled per-host without touching Core.
- **ffmpeg licensing.** → LGPL build, separate process, documented provenance.
- **WebView2 absent on old Windows.** → installer bootstraps the evergreen runtime.
- **Resource targets miss.** → M0 measures first; adjust architecture before UI spend.
- **Scope creep.** → non-goals in section 3; v1 stays a downloader, not a media suite.

## 16. Decisions & remaining defaults

Decided by user:
- **Name: Siphon** (kept; "Downrabbit" was considered but not used). The rabbit is the mascot.
- **Engine: Hybrid. Shell: Tauri 2. License: open source (Apache-2.0 recommended).**
- **UI: dark matte, terminal-feel, super-polished / artistic / simple, cute rabbit mascot
  with stateful animations** (section 8).

Remaining defaults (user may override):
- Bundled vs system ffmpeg: prefer system, else bundled LGPL on first use.
- Default download folder: user's `Downloads/Siphon`.
- Phosphor accent: green default (amber optional); no blue.