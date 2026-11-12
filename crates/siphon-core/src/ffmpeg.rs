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
