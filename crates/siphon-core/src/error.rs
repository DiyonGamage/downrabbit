use thiserror::Error;

#[derive(Debug, Error)]
pub enum SiphonError {
    #[error("extract failed: {0}")]
    Extract(String),
    #[error("unsupported link: {0}")]
    Unsupported(String),
    #[error("download failed: {0}")]
    Download(String),
    #[error("ffmpeg failed: {0}")]
    Ffmpeg(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, SiphonError>;
