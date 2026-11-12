# Siphon M0 report

| service | bytes | elapsed_ms | MB/s | peak_RAM_MB | peak_CPU% |
|---|---|---|---|---|---|
| youtube | 475961 | 15352 | 0.03 | 20.0 | 28.6 |
| reddit | ERROR | extract failed: yt-dlp: ERROR: [Reddit] 6rrwyj: Account authentication is required. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies | | | |

Targets (spec §9): active RAM ≤ 150 MB; throughput ≥ cobalt (target 2–5x large files).

## Verdict

**GO** — the M0 feasibility gate is met, with the explicit caveats below. This is a feasibility gate, not a performance certification.

- **RAM (hard gate, spec §9: active RAM ≤ 150 MB): MET.** Actual measured peak working set of the siphon-bench process during the YouTube run: **20.0 MB** (peak CPU 28.6%), far under the 150 MB limit. Measurement scope note: the sampler measures the bench process itself; yt-dlp/ffmpeg child-process memory is not included in this figure.
- **Pipeline: WORKS end-to-end.** YouTube "Me at the zoo" (jNQXAC9IVRw) completed the full pipeline — yt-dlp extraction + 8-connection segmented download + ffmpeg merge — producing 475,961 bytes in 15,352 ms (reproduces the Task 9 pass). The Reddit sample errored honestly at extraction: the native Reddit extractor failed (Reddit blocks its `siphon/0.0` user-agent) and the yt-dlp fallback reported "Account authentication is required" for that post. The router fallback and error reporting behaved as designed; a Reddit access strategy (UA/cookies) is an M1+ concern, not an M0 pipeline break.
- **Throughput caveat (NOT validated):** the measured 0.03 MB/s is for a ~19 s, ~0.45 MB clip and is dominated by yt-dlp process spawn + connection setup, NOT steady-state download speed. It CANNOT validate the spec's "2–5x cobalt on large files" claim. No cobalt baseline was measured and no single-stream comparison was run in this spike. The segmented downloader's speed advantage is architecturally proven (Task 7) but not benchmarked at scale here; a large-file throughput benchmark is deferred.
- **Startup < 300 ms (NOT measured):** `elapsed_ms` is total download time, not cold start. Bench does not measure startup latency; cold-start measurement is deferred to the M1 Tauri app. No startup figure is claimed.

Overall: **GO for M1** — the RAM hard gate is met (20.0 MB ≤ 150 MB) and the pipeline works end-to-end, subject to the throughput and startup caveats above.
