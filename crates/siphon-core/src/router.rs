use crate::error::{Result, SiphonError};
use crate::extractor::Extractor;
use crate::types::{MediaPlan, Options};
use url::Url;

pub struct ExtractorRouter {
    extractors: Vec<Box<dyn Extractor>>,
}

impl ExtractorRouter {
    pub fn new(extractors: Vec<Box<dyn Extractor>>) -> Self {
        Self { extractors }
    }

    pub async fn resolve(&self, url: &Url, opts: &Options) -> Result<MediaPlan> {
        let mut last_err: Option<SiphonError> = None;
        for e in &self.extractors {
            if !e.matches(url) {
                continue;
            }
            match e.extract(url, opts).await {
                Ok(plan) => return Ok(plan),
                Err(err) => last_err = Some(err),
            }
        }
        Err(last_err.unwrap_or_else(|| SiphonError::Unsupported(url.to_string())))
    }
}
