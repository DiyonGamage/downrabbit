# Siphon M0 report

**Status: GO on the spec §9 RAM hard gate after mitigation (2026-11-12).** The original M0 measurement was NO-GO (400.7 MB). Constraining yt-dlp's JavaScript runtime (`--no-js-runtimes`) brings the full-pipeline peak to **103.1 MB**, under the ≤150 MB gate. Throughput at scale and cold startup remain **deferred / not certified**.

## Current measurement (post-mitigation, official bench)

| service | bytes | elapsed_ms | MB/s | peak_RAM_MB | peak_CPU% |
|---|---|---|---|---|---|
| youtube | 475961 | 8221 | 0.06 | 103.1 | 171.4 |
| reddit | ERROR | extract failed: yt-dlp: ERROR: [Reddit] 6rrwyj: Account authentication is required. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies | | | |

Targets (spec §9): active RAM ≤ 150 MB; throughput ≥ cobalt (target 2–5x large files).

`peak_RAM_MB` = total working set of the entire descendant process tree rooted at the bench PID (bench + yt-dlp + its children + ffmpeg) — the metric §9 actually gates on (Ruling R9). Full pipeline exercised: yt-dlp extract → 8-connection segmented download → ffmpeg merge. `peak_CPU%` is a tree-wide sum (can exceed 100% on multi-core).

## Verdict

**GO on the RAM hard gate.** Post-mitigation full-pipeline peak = **103.1 MB ≤ 150 MB** (spec §9 line 40 / lines 208–209), ~47 MB headroom. The ≤120 MB "Active, yt-dlp fallback" row (line 208) is also met (yt-dlp subtree ≈ 90 MB). Pipeline feasibility is proven end-to-end and the resource budget is now certified for the YouTube path. This is a feasibility gate, not a performance certification — throughput and startup are still deferred.

### Mitigation applied: `--no-js-runtimes` (lever 2 — constrain yt-dlp's JS interpreter)

- **Change:** the yt-dlp adapter now passes `--no-js-runtimes` (`crates/siphon-core/src/engines/ytdlp.rs`, `ytdlp_args`). This stops yt-dlp spawning its default external JavaScript runtime (**Deno**) for YouTube nsig/signature deciphering. Implemented test-first (`args_disable_external_js_runtimes`); 29 offline tests green, build pristine.
- **Effect (official bench, same "Me at the zoo" clip, full pipeline):** peak RAM **400.7 MB → 103.1 MB** (−74%); elapsed **14,553 ms → 8,221 ms** (−44%, no Deno spawn overhead); identical 475,961-byte downloaded artifact and a valid merged `out/Me at the zoo.mp4` — **no pipeline regression**.
- **Quality preserved (verified on Big Buck Bunny 4K, `aqz-KE-bpKQ`):** with `--no-js-runtimes` yt-dlp falls back to the tv_samsung / visionos player clients and still returns the **full resolution ladder 144p–2160p** (53 formats vs 61 baseline; the 8 dropped are redundant variants, not resolutions). The direct `https` high-res formats download as **real video bytes** — 2160p vp9/webm (EBML magic `1a45dfa3`), 1080p/720p avc1/mp4 (ftyp magic `0000001c`), all HTTP 206. Format selection is **unchanged**: `best_video` picks the same direct `https` 2160p format (id401) with and without the flag (no HLS/m3u8 regression).
- **Worst-case RAM (4K extract, independent psutil process-tree probe):** yt-dlp tree peak **91.9 MB** (+ bench ~13 MB ⇒ ~105 MB total), 7.2 s. Extract is the peak state (the pipeline states are sequential — see baseline analysis), so 4K full-pipeline RAM is ~105 MB, under the gate.
- **Node is NOT a viable lighter runtime:** `--no-js-runtimes --js-runtimes node` measured **346.3 MB** tree (node.exe 236.6 MB) — nearly as heavy as Deno, **FAILS** the gate. Deno baseline on the same 4K clip: **359.1 MB** tree (deno.exe 254.9 MB), confirming the M0 finding.
- **No new dependency:** one argv flag; no interpreter installed. quickjs/bun were not on PATH (quickjs would be a tiny future option if the no-runtime fallback is ever removed).

### Caveats / not certified

- **Deprecation risk (track in M1):** yt-dlp warns *"YouTube extraction without a JS runtime has been deprecated, and some formats may be missing."* The fallback works today (full 4K ladder verified on two videos), but a future yt-dlp could remove it. The durable long-term fix is the **native Rust YouTube extractor** (lever 1, ~20 MB, eliminates yt-dlp entirely; spec lines 124–126/283 flag it as the hardest item). If the no-runtime fallback breaks: re-enable a lightweight runtime (quickjs, ~few MB — not installed, needs approval) or accelerate the native extractor. `--no-js-runtimes` is **global**, so JS-dependent non-YouTube sites may need a runtime re-enabled later; verify robustness across more videos/sites in M1.
- **Throughput at scale: NOT validated (deferred).** See the single-stream comparison below — a tiny clip cannot validate the "2–5x cobalt on large files" claim; a multi-hundred-MB benchmark is deferred. No cobalt baseline was measured; none is invented.
- **Startup < 300 ms: NOT measured.** `elapsed_ms` is total download time, not cold start. Deferred to the M1 Tauri app.
- **Native ≤80 MB no-merge row: NOT certified.** The native path was never successfully exercised (Reddit errored: native UA-block + yt-dlp auth-required). A working native sample is part of M1.
- **ffmpeg-merge-state RAM not separately resolved** (sub-second on the tiny clip; never appeared as the peak). No merge-state figure is claimed.

## Throughput comparison (single-stream vs segmented) — pre-mitigation data point

Paired run on the SAME clip (YouTube `jNQXAC9IVRw`), back-to-back from the repo root via the `run` subcommand (real network runs; `run` prints stats and does not overwrite this report). Measured **before** the JS-runtime constraint, so extraction included the Deno spawn:
- `--connections 1` (single-stream): **475,961 bytes / 15,541 ms / 0.0292 MB/s**.
- `--connections 8` (segmented): **475,961 bytes / 16,266 ms / 0.0279 MB/s**.
- **Interpretation:** on this ~19 s, ~0.45 MB clip both runs are dominated by extraction + connection setup, not steady-state transfer, so single-stream and 8-connection times are approximately equal (within run-to-run variance). This empirically confirms the tiny-clip throughput **CANNOT** validate the "2–5x cobalt on large files" claim. Post-mitigation extraction is ~2x faster, but the clip is still too small to demonstrate a segmented speedup; the conclusion stands and a large-file benchmark remains **deferred**.

## M0 baseline (pre-mitigation) — preserved audit record

The original M0 measurement (before `--no-js-runtimes`) was **NO-GO on the RAM hard gate**, and the analysis below is retained as the audit trail that motivated the mitigation.

- **RAM hard gate (spec §9 line 40 / 208–209, INCLUDING yt-dlp + ffmpeg transients): MISSED.** Real measured YouTube full-pipeline peak: **400.7 MB** — **2.7x over** the 150 MB limit. An earlier 20.0 MB figure was the bench process alone and was an overclaim against this gate; superseded by the tree measurement (R9).
  - **Where the memory went (independently corroborated):** peak in the **extract** state; dominant contributor was *not* Siphon's Rust code. Tree composition at peak: `siphon-bench.exe` 13.0 MB + `yt-dlp.exe` (PyInstaller bootloader) 8.8 MB + `yt-dlp.exe` (Python runtime) 97.4 MB + **`deno.exe` 288.5 MB** = 407.8 MB. Deno is yt-dlp's JavaScript interpreter for YouTube signature/nsig deciphering, a **great-grandchild** (bench → yt-dlp bootloader → yt-dlp Python → deno) — which is why a transitive tree closure, not a direct-children sum, is required. The spec's "+ transient Python proc" budget did not anticipate this interpreter subprocess. **The mitigation removes exactly this Deno process.**
  - The ≤120 MB "yt-dlp fallback" row was likewise missed for the same reason; with Deno excluded the extract state was ~104 MB (the Python runtime alone fit that row) — consistent with the post-mitigation 103.1 MB.
  - **Sequential-state nuance:** the states do not overlap — yt-dlp and Deno exit before the download finishes and ffmpeg starts. The tree peak equals the worst *single* state (extract), not a simultaneous sum. This is why the 4K extract probe (~105 MB total) bounds the 4K full-pipeline peak.
  - **Verification the number was real:** three benchmark runs gave **383.4 / 375.2 / 400.7 MB** (Deno working-set variance). An independent WMI (`Win32_Process`) tree probe — different API, explicit parent-PID links — measured **358.1 MB** and **407.8 MB** with the same four-process composition, agreeing with sysinfo within ~5%.
- **Pipeline: WORKED end-to-end** (YouTube extract + 8-connection segmented download + ffmpeg merge, 475,961 bytes). Reddit errored honestly at extraction (native UA-block + yt-dlp auth-required); router fallback and error reporting behaved as designed. A Reddit access strategy (browser-like UA / cookies) is an M1+ concern.
- **Mitigation levers as originally identified (spec line 215):** (1) native extractors shadow yt-dlp → Rust-only ~20 MB (hardest for YouTube); (2) constrain yt-dlp's JS-interpreter / player-client argv → **CHOSEN AND IMPLEMENTED, gate now met**; (3) re-baseline §9 → not needed (lever 2 succeeded).

Overall: **GO on the RAM hard gate after mitigation (103.1 MB ≤ 150 MB).** Pipeline feasibility proven; resource budget certified for the YouTube path. Throughput at scale and cold startup remain unvalidated (deferred); the native ≤80 MB row is uncertified; the yt-dlp no-runtime deprecation is a tracked M1 risk. M1 UI work is no longer gated by the RAM budget.