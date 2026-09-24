//! File-based streaming transfer of packed archives to storage (ticket 85).
//!
//! The upload body never loads into the webview: this command streams the
//! archive file to the target URL straight from disk. [`ureq`] reads the file
//! through its bounded I/O buffers (128 KiB each) and derives `Content-Length`
//! from the file size, so process memory does not scale with the archive.
//!
//! Only archives packed or staged by [`crate::fs25::pack`] may be sent: the
//! frontend has no filesystem plugin, and this guard keeps arbitrary local
//! files out of the transfer.

use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

use crate::fs25::contract::Fs25Error;
use crate::fs25::pack;

/// Request headers the HTTP stack owns and must not be forwarded: `host`
/// comes from the target URL (the value the presigned signature covers),
/// `content-length` from the file size, and `transfer-encoding` from the
/// transport. The webview's fetch silently dropped these as forbidden request
/// headers; the file-based transport makes the rule explicit.
const RESERVED_HEADERS: [&str; 3] = ["host", "content-length", "transfer-encoding"];

/// Stream `archive_path` to `url` with the given method and headers, resolving
/// the response status. A non-2xx status is data, not an error — the caller
/// maps it to user-facing copy — while DNS/TLS/IO failures are
/// [`Fs25Error::Internal`]. Memory is bounded by the transport buffers, not by
/// the archive size.
pub fn put_archive(
    archive_path: &Path,
    url: &str,
    method: &str,
    headers: &HashMap<String, String>,
) -> Result<u16, Fs25Error> {
    if !pack::is_managed_archive(archive_path) {
        return Err(Fs25Error::Internal {
            message: format!(
                "refusing to transfer unmanaged file: {}",
                archive_path.display()
            ),
        });
    }
    let file = File::open(archive_path).map_err(|err| Fs25Error::Inaccessible {
        path: archive_path.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    if !file
        .metadata()
        .map(|meta| meta.is_file())
        .unwrap_or(false)
    {
        return Err(Fs25Error::Internal {
            message: format!("not a regular file: {}", archive_path.display()),
        });
    }

    let method: ureq::http::Method = method.parse().map_err(|err| Fs25Error::Internal {
        message: format!("invalid transfer method {method:?}: {err}"),
    })?;
    let mut builder = ureq::http::Request::builder().method(method).uri(url);
    for (key, value) in headers {
        if RESERVED_HEADERS.contains(&key.to_ascii_lowercase().as_str()) {
            continue;
        }
        builder = builder.header(key, value);
    }
    let request = builder.body(file).map_err(|err| Fs25Error::Internal {
        message: format!("failed to build storage request: {err}"),
    })?;

    match ureq::run(request) {
        Ok(response) => Ok(response.status().as_u16()),
        Err(ureq::Error::StatusCode(code)) => Ok(code),
        Err(err) => Err(Fs25Error::Internal {
            message: format!("transfer to storage failed: {err}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    type Captured = (Vec<String>, Vec<u8>);

    /// One-shot HTTP server capturing a single request. Returns the target URL
    /// and a handle yielding the request head lines and body once served.
    fn serve_once(
        respond_with: &'static str,
    ) -> (String, std::thread::JoinHandle<Captured>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = Vec::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                head.push(line.trim_end().to_string());
            }
            let mut content_length = 0usize;
            for line in &head {
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().unwrap();
                }
            }
            let mut body = vec![0u8; content_length];
            reader.read_exact(&mut body).unwrap();
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 {respond_with}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .unwrap();
            (head, body)
        });
        let url = format!("http://{addr}/bucket/farms/f1/players/u1/save");
        (url, handle)
    }

    fn staged_archive(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("fs25-pack-{name}-{}.zip", std::process::id()));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn put_archive_streams_the_file_with_content_length_and_headers() {
        let payload = vec![42u8; 300_000];
        let archive = staged_archive("transfer-ok", &payload);
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "application/zip".to_string());
        headers.insert("x-amz-meta-abc".to_string(), "123".to_string());
        // Stack-owned headers must not be forwarded.
        headers.insert("host".to_string(), "evil.example".to_string());
        headers.insert("content-length".to_string(), "999999".to_string());

        let (url, server) = serve_once("200 OK");
        let status = put_archive(&archive, &url, "PUT", &headers).unwrap();
        let (head, body) = server.join().unwrap();

        assert_eq!(status, 200);
        assert_eq!(head[0], "PUT /bucket/farms/f1/players/u1/save HTTP/1.1");
        assert!(
            head.iter()
                .any(|line| line.eq_ignore_ascii_case(&format!("content-length: {}", payload.len()))),
            "file size becomes content-length: {head:?}"
        );
        assert!(
            head.iter()
                .any(|line| line.eq_ignore_ascii_case("content-type: application/zip")),
            "custom headers forwarded: {head:?}"
        );
        assert!(
            !head.iter().any(|line| line.eq_ignore_ascii_case("host: evil.example")),
            "reserved host header must not be forwarded: {head:?}"
        );
        assert_eq!(body, payload, "body is streamed byte-for-byte from disk");

        let _ = std::fs::remove_file(&archive);
    }

    #[test]
    fn non_2xx_status_is_data_not_an_error() {
        let archive = staged_archive("transfer-status", b"tiny");
        let (url, server) = serve_once("403 Forbidden");
        assert_eq!(put_archive(&archive, &url, "PUT", &HashMap::new()).unwrap(), 403);
        server.join().unwrap();
        let _ = std::fs::remove_file(&archive);
    }

    #[test]
    fn unmanaged_files_are_never_sent() {
        let foreign = std::env::temp_dir().join(format!("not-ours-{}.bin", std::process::id()));
        std::fs::write(&foreign, b"secret").unwrap();

        let err = put_archive(
            &foreign,
            "http://127.0.0.1:1/exfil",
            "PUT",
            &HashMap::new(),
        )
        .unwrap_err();
        match err {
            Fs25Error::Internal { message } => {
                assert!(message.contains("unmanaged"), "unexpected message: {message}")
            }
            other => panic!("unexpected error: {other:?}"),
        }
        assert_eq!(std::fs::read(&foreign).unwrap(), b"secret", "file untouched");

        let _ = std::fs::remove_file(&foreign);
    }

    #[test]
    fn invalid_method_is_rejected_before_transfer() {
        let archive = staged_archive("transfer-method", b"tiny");
        let err = put_archive(
            &archive,
            "http://127.0.0.1:1/nowhere",
            "NOT A METHOD",
            &HashMap::new(),
        )
        .unwrap_err();
        assert!(matches!(err, Fs25Error::Internal { .. }));
        let _ = std::fs::remove_file(&archive);
    }
}
