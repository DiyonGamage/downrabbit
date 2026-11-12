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
               "-c:v", "mpeg4", "-pix_fmt", "yuv420p", v.to_str().unwrap()])
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
