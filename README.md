# Downrabbit

**Download anything, one command.**

```
downr https://youtu.be/dQw4w9WgXcQ
```

A tiny, no-nonsense media downloader for your terminal. One command installs the whole
engine — about 120 MB of Node, yt-dlp and ffmpeg — and then `downr` fetches video or audio
from YouTube, TikTok, Instagram, Reddit, X, SoundCloud and thousands of other sites. No
browser tab, no account, no server of ours, no telemetry. Just a file in your Downloads folder.

Downrabbit is a clean-room, open-source take on the *idea* of [cobalt](https://github.com/imputnet/cobalt)
(not its code), rebuilt as a single command with no web service in the loop.

- **Site:** [downrabbit.pages.dev](https://downrabbit.pages.dev) — landing page, install commands, FAQ
- **License:** Apache-2.0
- **Runs:** Windows 10/11, macOS, Linux, Android (Termux)

## Install

One command, no admin, no dependencies to manage.

**Windows** (PowerShell — paste into Start → "PowerShell"):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://downrabbit.pages.dev/install.ps1 | iex"
```

**macOS / Linux / Android (Termux):**

```sh
curl -fsSL https://downrabbit.pages.dev/install.sh | sh
```

The installer downloads the engine into your user folder, puts `downr` on your PATH, and
checks it runs. Open a new terminal afterwards. Installs are ordinary files — delete the
folder to uninstall (the installer prints its location).

## Use

```
downr <link>                      best quality video, saved to Downloads
downr <link> 1080p                cap the resolution (2160p/1440p/1080p/720p/480p/360p)
downr <link> audio                audio only, original format
downr <link> mp3                  audio only, converted to mp3
downr <link> -q 1080              long form of the quality shortcut
downr <link> -a                   long form of audio
downr <link> -m                   long form of mp3
downr <link> -o "D:\Videos"       save somewhere else
downr <link> --name "my clip"     pick the filename
downr <link1> <link2> ...         several links, one after another
downr                             asks you to paste a link
downr --help                      every option
```

A live gradient progress bar shows the title and speed right in your terminal. `Ctrl+C` cancels.

### What you get

- **Any site yt-dlp knows** — YouTube, TikTok, Instagram, Reddit, X, Facebook, Vimeo, Twitch,
  SoundCloud, Bilibili, Dailymotion, Pinterest, Tumblr, Kick, Rumble, Odysee, Streamable,
  Imgur, Giphy, LinkedIn, Snapchat, and most others. yt-dlp updates itself at most once a day.
- **Real quality choices** — best available, a specific height, original audio, or MP3.
- **Fast local engine** — after resolving, the engine issues parallel HTTP Range requests,
  merging audio/video with the bundled ffmpeg. No cloud service sits between you and the file.
- **Honest about limits** — Spotify is DRM-protected and unsupported. Some sites
  (Instagram, Facebook, X, age-restricted YouTube) need cookies; see below.

## How it works

`downr` is a small Node script. On the first download it starts a local engine
(`bridge/server.js`) on `127.0.0.1:8765`, which shells out to yt-dlp for metadata and
fragments and to ffmpeg for merging or MP3 conversion. When the last download finishes, the
engine stops. Nothing listens on your network, nothing runs at boot, nothing phones home.

```
downr  →  engine (127.0.0.1:8765)  →  yt-dlp / ffmpeg  →  your Downloads folder
```

The engine exposes a tiny JSON API (`/resolve`, `/prepare`, `/job/:id`, `/file/:id`) and is
spawned with an argv array — never a shell string — so links cannot inject commands.
Filenames are sanitized and output stays inside the folder you chose.

### Portable copy

`bridge/make-portable.ps1` builds `dist/downrabbit-portable/` plus a zip containing
`node.exe`, the engine, yt-dlp and ffmpeg. Copy it to any Windows 10/11 PC and run
`downr.cmd` from that folder, or `install-cli.cmd` once to get `downr` on PATH.
No installer, no registry, no admin.

## Options

Set these in the environment before running `downr` (the CLI passes them to the engine):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_PORT` | `8765` | Engine port |
| `BRIDGE_FRAGMENTS` | `24` | yt-dlp concurrent fragments |
| `BRIDGE_HTTP_CHUNK` | `16M` | yt-dlp HTTP chunk size |
| `BRIDGE_MAX_FILESIZE` | `8G` | Reject larger files |
| `BRIDGE_MAX_ACTIVE` | `3` | Simultaneous jobs |
| `BRIDGE_COOKIES_FROM_BROWSER` | *(off)* | `chrome`, `edge`, `firefox`, … for login-gated sites |
| `BRIDGE_COOKIE_FILE` | *(off)* | Path to a Netscape `cookies.txt` |
| `BRIDGE_PROXY` | *(off)* | Proxy URL |
| `BRIDGE_IMPERSONATE` | *(off)* | yt-dlp impersonation target |
| `BRIDGE_AUTO_UPDATE` | `1` | Update yt-dlp at most once a day |

Cookies are read from your own browser profile only when you opt in; nothing is uploaded.

## Site

`webapp/index.html` is the landing page — one self-contained file, no build step. It shows the
install commands with copy buttons, a terminal demo, the full command reference and FAQ, plus
the rabbit. Deploy it anywhere static (Cloudflare Pages uses the `webapp` folder as output).

## Repo layout

- `webapp/index.html` — landing page (self-contained HTML/CSS/JS).
- `webapp/install.ps1` — Windows installer used by the one-liner.
- `webapp/install.sh` — macOS / Linux / Termux installer.
- `bridge/downr.js` — the `downr` command.
- `bridge/server.js` — local download engine (zero npm dependencies).
- `bridge/setup.ps1` — dev setup: fetches yt-dlp + ffmpeg into `bridge/bin/`.
- `bridge/make-portable.ps1` — builds the portable Windows bundle.
- `bridge/install-cli.cmd` / `remove-cli.cmd` — add/remove `downr` from a portable folder.
- `bridge/bin/` — yt-dlp/ffmpeg binaries for development (gitignored).

## Privacy & safety

- Zero telemetry, zero analytics, zero accounts. Network is used only for the downloads you
  start (plus a once-a-day yt-dlp self-update, disable with `BRIDGE_AUTO_UPDATE=0`).
- The engine binds to `127.0.0.1` when started by `downr`, so other devices cannot reach it.
- Only public URLs are fetched (SSRF guards), filenames are sanitized, no path traversal.
- Clean-room: no cobalt source was copied.

## License

Apache-2.0. See [LICENSE](LICENSE). Bundled components keep their own licenses: Node.js (MIT),
yt-dlp (Unlicense), ffmpeg (GPL build, separate executable).
