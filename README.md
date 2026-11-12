# Downrabbit

**Paste a link, get the file.** A tiny, no-nonsense media downloader: a single static
HTML app for direct files, plus an optional local bridge for YouTube, TikTok and most
other sites yt-dlp supports. No account, no server of ours, no telemetry.

Downrabbit is a clean-room, open-source take on the *idea* of [cobalt](https://github.com/imputnet/cobalt)
(not its code), rebuilt to be dramatically lighter: the webapp is one static HTML file
with zero dependencies and zero build step.

- **Live:** host it yourself (see [Hosting](#hosting)) — e.g. Cloudflare Pages → `downrabbit.pages.dev`
- **License:** Apache-2.0
- **Mascot:** a stateful ink-line rabbit that reacts to every download

## What it does

Paste a **direct file link** (`.mp4`, `.mp3`, `.zip`, …) and Downrabbit streams it to your disk:

- **Options before you download** — a quick card shows the detected type, size and host, lets you
  rename the file and pick connections (1–8) before anything is written.
- **Multi-connection downloads** — parallel HTTP Range requests (configurable 1–8) for speed.
- **Streams to disk** — uses the File System Access API where available, so memory stays tiny
  even for large files; falls back to an in-browser blob + save when the picker isn't supported.
- **Pause / resume / cancel** — durable chunk tracking picks up exactly where it left off.

Paste a **platform page** and, with the optional local bridge running, Downrabbit can fetch it too:

- YouTube, TikTok, Instagram, Reddit, X, Facebook, Vimeo, Twitch, SoundCloud, Bilibili,
  Dailymotion, Pinterest, Tumblr, Kick, Rumble, Odysee, Streamable, Imgur, Giphy, LinkedIn,
  Snapchat, and most other sites yt-dlp supports.
- Real quality choices: best, a specific height, original audio, or MP3 (re-encode) where
  ffmpeg supports it.
- The bridge downloads and merges locally; Downrabbit then uses its own multi-connection
  downloader to save the prepared file.

Also included:

- **Honest about scope** — direct links work without any install. Platform pages need the local
  bridge; Spotify is DRM-protected and stays unsupported.
- **Graceful fallback** — if a host blocks in-app reads, Downrabbit offers a native browser download.
- **History, settings, themes** — download history with re-download/copy/remove, filename
  templates, concurrency, dark-matte + creamy-white themes, amber/green phosphor accent,
  reduced-motion mode.

Everything stays in your browser or on your machine. Nothing leaves your computer except the
downloads you ask for.

## The local bridge

Browsers cannot run `yt-dlp` or bypass CORS, so platform pages go through a tiny Node.js
bridge on `127.0.0.1:8765`. It has **zero npm dependencies**, wraps yt-dlp + ffmpeg, and runs
only on your machine. The webapp probes it automatically and shows `connected` in settings.

### Windows (one-time setup)

```powershell
cd bridge
.\setup.ps1
.\start.ps1
```

`setup.ps1` downloads yt-dlp and a full ffmpeg build (with MP3 support) into `bridge/bin/`.
`start.ps1` launches the bridge. Keep the window open while downloading; the webapp will
detect it.

### macOS / Linux

Install `yt-dlp` and `ffmpeg` with your package manager (for example `brew install yt-dlp ffmpeg`
or `sudo apt install yt-dlp ffmpeg`), then:

```sh
cd bridge
./start.sh
```

### Options

Set these before starting the bridge:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_PORT` | `8765` | Port to listen on |
| `BRIDGE_MAX_ACTIVE` | `2` | Simultaneous bridge jobs |
| `BRIDGE_FRAGMENTS` | `16` | yt-dlp concurrent fragments |
| `BRIDGE_HTTP_CHUNK` | `10M` | yt-dlp HTTP chunk size |
| `BRIDGE_MAX_FILESIZE` | `8G` | Reject larger files |
| `BRIDGE_FILE_TTL_MS` | `3600000` | How long prepared files stay available |
| `BRIDGE_JOB_TTL_MS` | `7200000` | How long job records stay available |
| `BRIDGE_ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `BRIDGE_COOKIES_FROM_BROWSER` | *(off)* | `chrome`, `edge`, `firefox`, … for login-gated sites |
| `BRIDGE_COOKIE_FILE` | *(off)* | Path to a Netscape `cookies.txt` file |
| `BRIDGE_PROXY` | *(off)* | Proxy URL |
| `BRIDGE_IMPERSONATE` | *(off)* | yt-dlp impersonation target |
| `BRIDGE_AUTO_UPDATE` | `1` | Update yt-dlp at most once a day |

### Limits and notes

- **Spotify** is DRM-protected and cannot be downloaded; the app says so.
- Some sites (Instagram, Facebook, X, age-restricted YouTube) need browser cookies. Set
  `BRIDGE_COOKIES_FROM_BROWSER=chrome` (or `edge`/`firefox`) and restart the bridge.
- **1080p+** and **MP3** need ffmpeg. `setup.ps1` installs a build with libmp3lame; if your
  PATH ffmpeg lacks it, the bridge hides the MP3 option and tells you to run setup.
- Prepared files are cleaned up automatically after the TTL. Use **cancel** or **dismiss** in
  the queue to remove them immediately.
- The bridge binds to `127.0.0.1`, has SSRF guards, a request rate limit, and CORS locked to
  the configured origin(s).

## What it does NOT do

- Spotify, or any other DRM-protected service.
- Sites that yt-dlp does not support.
- Platform pages when the bridge is not running.

## Run it

No build, no dependencies for the webapp. Either:

- Open `webapp/index.html` directly in a Chromium-based browser (best experience), or
- Serve the folder with any static server, e.g. `npx serve webapp` or `python -m http.server -d webapp`.

For platform downloads, start the bridge first (above). Chromium gives the full stream-to-disk +
pause/resume experience; other browsers fall back to blob/browser downloads gracefully.

## Hosting

It's a static site. Any static host works. For Cloudflare Pages:

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
3. Build settings: framework preset **None**, build command *(empty)*, build output directory **`webapp`**.
4. Deploy. You get `https://<project>.pages.dev`.

## Repo layout

- `webapp/` — **the product.** Single self-contained `index.html` (UI + download engine + rabbit rig).
- `bridge/` — optional local yt-dlp/ffmpeg bridge (Node.js, zero npm deps).
- `bridge/setup.ps1`, `bridge/start.ps1`, `bridge/start.cmd`, `bridge/start.sh` — setup and launch scripts.
- `bridge/bin/` — downloaded yt-dlp/ffmpeg binaries (gitignored).

## Privacy & safety

- Zero telemetry, zero analytics, zero accounts. Network is used only for the downloads you initiate.
- Filenames are sanitized; no path traversal. Clean-room: no cobalt source copied.
- The bridge binds to `127.0.0.1` by default and only downloads URLs you submit.

## License

Apache-2.0. See [LICENSE](LICENSE).
