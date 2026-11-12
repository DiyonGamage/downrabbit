use siphon_core::download::{download_segmented, split_ranges};
use std::io::{Read, Write};
use std::net::TcpListener;

#[test]
fn splits_into_contiguous_inclusive_ranges() {
    let r = split_ranges(100, 4);
    assert_eq!(r, vec![(0, 24), (25, 49), (50, 74), (75, 99)]);
    assert_eq!(split_ranges(10, 1), vec![(0, 9)]);
    assert_eq!(split_ranges(3, 8).len(), 3); // never more parts than bytes
}

fn spawn_server(body: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut s = stream.unwrap();
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let total = body.len();
            let range = req.lines().find(|l| l.to_ascii_lowercase().starts_with("range:"));
            let (start, end, status) = if let Some(r) = range {
                let spec = r.split('=').nth(1).unwrap().trim();
                let mut parts = spec.split('-');
                let start: usize = parts.next().unwrap().parse().unwrap();
                let end: usize = parts.next().unwrap_or("").parse().unwrap_or(total - 1);
                (start, end.min(total - 1), "206 Partial Content")
            } else {
                (0, total - 1, "200 OK")
            };
            let slice = &body[start..=end];
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\nConnection: close\r\n\r\n",
                slice.len()
            );
            let _ = s.write_all(head.as_bytes());
            let _ = s.write_all(slice);
            let _ = s.flush();
        }
    });
    (format!("http://{addr}/file"), handle)
}

#[tokio::test]
async fn downloads_full_file_via_segments() {
    let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    let (url, _h) = spawn_server(body.clone());
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("out.bin");
    let client = reqwest::Client::new();
    let n = download_segmented(&client, &url, &[], &dest, 8).await.unwrap();
    assert_eq!(n as usize, body.len());
    let got = std::fs::read(&dest).unwrap();
    assert_eq!(got, body);
}