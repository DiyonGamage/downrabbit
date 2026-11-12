use crate::error::Result;
use crate::types::{MediaPlan, Options};
use async_trait::async_trait;
use url::Url;

#[async_trait]
pub trait Extractor: Send + Sync {
    fn id(&self) -> &'static str;
    fn matches(&self, url: &Url) -> bool;
    async fn extract(&self, url: &Url, opts: &Options) -> Result<MediaPlan>;
}
