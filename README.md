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
bridge on port `8765`. It has **zero npm dependencies**, wraps yt-dlp + ffmpeg, and runs
only on your machine. The webapp probes it automatically and shows `connected` in settings.

The bridge also **serves the webapp itself** at `http://127.0.0.1:8765`, so the app and the
bridge share one origin — no browser local-network permission prompt, no mixed-content block.
Double-click `bridge/Downrabbit.cmd` (Windows) to start it and open the app in one step.

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

### Use it on your phone or another PC

The bridge runs on one computer, but any device on the **same Wi-Fi** can use it. By default
the bridge listens on all interfaces (`0.0.0.0`), so it is reachable at your PC's LAN address,
e.g. `http://192.168.1.20:8765`. Open that address in the other device's browser — the app is
served from the bridge, so it is same-origin plain HTTP: **no permission prompt, works in
Firefox and Safari too**, and downloads run on the PC.

1. On the PC, start the bridge (`Downrabbit.cmd`). The launcher prints the **On your network**
   address; it is also in the app under **settings → open on another device** (with a copy button).
2. First time only: double-click `bridge/allow-firewall.cmd` on the PC and approve the UAC prompt.
   It adds one inbound rule for TCP 8765 so other devices can reach it (applies to the active
   network profile, including a phone hotspot marked Public).
3. On the phone/tablet/other PC, open the network address and paste a link.

If a phone still cannot connect, the Wi-Fi may isolate clients from each other (common on guest
networks and some phone hotspots). Turn off "AP isolation" / allow devices to communicate, or use
a normal router Wi-Fi. Both devices must be on the same network.

To keep the bridge private to this PC only, start it with `BRIDGE_HOST=127.0.0.1`.

### Options

Set these before starting the bridge:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_PORT` | `8765` | Port to listen on |
| `BRIDGE_HOST` | `0.0.0.0` | Bind address; set `127.0.0.1` to keep it local-only |
| `BRIDGE_MAX_ACTIVE` | `3` | Simultaneous bridge jobs |
| `BRIDGE_FRAGMENTS` | `24` | yt-dlp concurrent fragments |
| `BRIDGE_HTTP_CHUNK` | `16M` | yt-dlp HTTP chunk size |
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
- The bridge binds to `0.0.0.0` by default so other devices on your Wi-Fi can use it (set
  `BRIDGE_HOST=127.0.0.1` for local-only). It has SSRF guards, a request rate limit, and CORS
  locked to the configured origin(s).

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
- `bridge/Downrabbit.cmd` — Windows one-click launcher: starts the bridge, prints the LAN address, opens the app.
- `bridge/allow-firewall.cmd` — one-time, user-approved inbound rule so other Wi-Fi devices can reach the bridge.
- `bridge/install-autostart.cmd` / `remove-autostart.cmd` — optional start-with-Windows (hidden).
- `bridge/bin/` — downloaded yt-dlp/ffmpeg binaries (gitignored).

## Privacy & safety

- Zero telemetry, zero analytics, zero accounts. Network is used only for the downloads you initiate.
- Filenames are sanitized; no path traversal. Clean-room: no cobalt source copied.
- The bridge listens on your local network by default (`0.0.0.0`) and only downloads URLs you
  submit. Set `BRIDGE_HOST=127.0.0.1` to restrict it to this PC.

## License

Apache-2.0. See [LICENSE](LICENSE).
