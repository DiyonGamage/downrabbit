use async_trait::async_trait;
use siphon_core::error::{Result, SiphonError};
use siphon_core::extractor::Extractor;
use siphon_core::router::ExtractorRouter;
use siphon_core::types::{MediaPlan, Options};
use url::Url;

struct Fake { id: &'static str, host: &'static str, fail: bool }

#[async_trait]
impl Extractor for Fake {
    fn id(&self) -> &'static str { self.id }
    fn matches(&self, url: &Url) -> bool { url.host_str() == Some(self.host) }
    async fn extract(&self, _url: &Url, _o: &Options) -> Result<MediaPlan> {
        if self.fail { return Err(SiphonError::Extract("boom".into())); }
        Ok(MediaPlan { service: self.id.into(), items: vec![] })
    }
}

struct CatchAll;
#[async_trait]
impl Extractor for CatchAll {
    fn id(&self) -> &'static str { "fallback" }
    fn matches(&self, _u: &Url) -> bool { true }
    async fn extract(&self, _u: &Url, _o: &Options) -> Result<MediaPlan> {
        Ok(MediaPlan { service: "fallback".into(), items: vec![] })
    }
}

fn u(s: &str) -> Url { Url::parse(s).unwrap() }

#[tokio::test]
async fn native_wins_over_fallback() {
    let r = ExtractorRouter::new(vec![
        Box::new(Fake { id: "reddit", host: "reddit.com", fail: false }),
        Box::new(CatchAll),
    ]);
    let plan = r.resolve(&u("https://reddit.com/x"), &Options::default()).await.unwrap();
    assert_eq!(plan.service, "reddit");
}

#[tokio::test]
async fn falls_back_when_native_fails() {
    let r = ExtractorRouter::new(vec![
        Box::new(Fake { id: "reddit", host: "reddit.com", fail: true }),
        Box::new(CatchAll),
    ]);
    let plan = r.resolve(&u("https://reddit.com/x"), &Options::default()).await.unwrap();
    assert_eq!(plan.service, "fallback");
}

#[tokio::test]
async fn fallback_used_for_unknown_host() {
    let r = ExtractorRouter::new(vec![
        Box::new(Fake { id: "reddit", host: "reddit.com", fail: false }),
        Box::new(CatchAll),
    ]);
    let plan = r.resolve(&u("https://example.com/x"), &Options::default()).await.unwrap();
    assert_eq!(plan.service, "fallback");
}

#[tokio::test]
async fn unsupported_when_no_match() {
    let r = ExtractorRouter::new(vec![Box::new(Fake { id: "reddit", host: "reddit.com", fail: false })]);
    let err = r.resolve(&u("https://example.com/x"), &Options::default()).await.unwrap_err();
    assert!(matches!(err, SiphonError::Unsupported(_)));
}
