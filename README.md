# Downrabbit

**Paste a direct link, get the file.** A tiny, no-nonsense media downloader that runs
entirely in your browser. No install, no account, no server, no telemetry.

Downrabbit is a clean-room, open-source take on the *idea* of [cobalt](https://github.com/imputnet/cobalt)
(not its code), rebuilt to be dramatically lighter: the whole app is a single static
HTML file with zero dependencies and zero build step. Open it and it runs.

- **Live:** host it yourself (see [Hosting](#hosting)) — e.g. Cloudflare Pages → `downrabbit.pages.dev`
- **License:** Apache-2.0
- **Mascot:** a stateful ink-line rabbit that reacts to every download

## What it does

Paste a **direct file link** (`.mp4`, `.mp3`, `.zip`, …) and Downrabbit streams it to your disk:

- **Options before you download** — a quick card shows the detected type, size and host, lets you
  rename the file and pick connections (1–8) before anything is written. Quality and audio are
  whatever the source file already has — no fake toggles.
- **Multi-connection downloads** — parallel HTTP Range requests (configurable 1–8) for speed.
- **Streams to disk** — uses the File System Access API where available, so memory stays tiny
  even for large files; falls back to an in-browser blob + save when the picker isn't supported.
- **Pause / resume / cancel** — durable chunk tracking picks up exactly where it left off.
- **Honest about scope** — it fetches *direct, CORS-open media links only*. YouTube, TikTok,
  Instagram, Reddit and similar are *pages*, not files; Downrabbit tells you so instead of faking it.
- **Graceful fallback** — if a host blocks in-app reads, Downrabbit offers a native browser download.
- **History, settings, themes** — download history with re-download/copy/remove, filename
  templates, concurrency, dark-matte + creamy-white themes, amber/green phosphor accent,
  reduced-motion mode.

Everything stays in your browser. Nothing leaves your machine except the downloads you ask for.

## What it does NOT do

Downrabbit is a **pure client-side webapp**. Browsers cannot run `yt-dlp` or bypass CORS, so Downrabbit
deliberately does **not** extract from platform pages (YouTube/TikTok/etc.). That needs a server,
which Downrabbit doesn't have. For those, use a dedicated tool. This is a feature, not a bug: it keeps
Downrabbit free, private, install-free, and honest.

## Run it

No build, no dependencies. Either:

- Open `webapp/index.html` directly in a Chromium-based browser (best experience), or
- Serve the folder with any static server, e.g. `npx serve webapp` or `python -m http.server -d webapp`.

Chromium gives the full stream-to-disk + pause/resume experience; other browsers fall back to
blob downloads gracefully.

## Hosting

It's a static site. Any static host works. For Cloudflare Pages:

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
3. Build settings: framework preset **None**, build command *(empty)*, build output directory **`webapp`**.
4. Deploy. You get `https://<project>.pages.dev`.

## Repo layout

- `webapp/` — **the product.** Single self-contained `index.html` (UI + download engine + rabbit rig).

That's the whole app. An earlier native Rust engine feasibility spike and its design docs were
removed once the pure webapp shipped; they remain in the git history if you're curious.

## Privacy & safety

- Zero telemetry, zero analytics, zero accounts. Network is used only for the downloads you initiate.
- Filenames are sanitized; no path traversal. Clean-room: no cobalt source copied.

## License

Apache-2.0. See [LICENSE](LICENSE).