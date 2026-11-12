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