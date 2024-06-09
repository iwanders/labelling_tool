use tiny_http;
use serde::{Deserialize, Serialize, Deserializer, Serializer };
use tiny_http::Method;
use std::sync::Arc;
use std::thread;

use ascii::AsciiString;
use std::fs;
use std::path::Path;

use crate::{segment::SegmentAnything, segment};

fn get_content_type(path: &Path) -> &'static str {
    let extension = match path.extension() {
        None => return "text/plain",
        Some(e) => e,
    };

    match extension.to_str().unwrap() {
        "css" => "text/css",
        "js" => "application/javascript",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "gif" => "image/gif",
        "jpg" => "image/jpeg",
        "jpeg" => "image/jpeg",
        "png" => "image/png",
        "pdf" => "application/pdf",
        "htm" => "text/html; charset=utf8",
        "html" => "text/html; charset=utf8",
        "txt" => "text/plain; charset=utf8",
        _ => "text/plain; charset=utf8",
    }
}

fn file_to_response(path: &std::path::Path, file: std::fs::File) -> Response<std::fs::File> {
    let response = tiny_http::Response::from_file(file);
    response.with_header(tiny_http::Header {
        field: "Content-Type".parse().unwrap(),
        value: AsciiString::from_ascii(get_content_type(path)).unwrap(),
    })
}

use tiny_http::Request;
use tiny_http::Response;
use tiny_http::ResponseBox;
type BackendError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Serialize, Deserialize)]
struct Foo {
    z: u8,
}

trait AllowCors {
    fn allow_cors(self) -> Self;
}
impl<T:std::io::Read> AllowCors for tiny_http::Response<T> {
    fn allow_cors(self) ->  Self {
        self.with_header(tiny_http::Header {
            field: "Access-Control-Allow-Origin".parse().unwrap(),
            value: AsciiString::from_ascii("*").unwrap(),
        }).with_header(tiny_http::Header {
            field: "Access-Control-Allow-Headers".parse().unwrap(),
            value: AsciiString::from_ascii("*").unwrap(),
        })
    }
}

pub fn deserialize_base64_string<'de, D>(
    deserializer: D,
) -> core::result::Result<Vec<u8>, D::Error>
where
    D: Deserializer<'de>,
{
    let input: &str = Deserialize::deserialize(deserializer)?;
    use base64::{Engine as _, engine::{general_purpose}};
    use serde::de::Error;
    let bytes = general_purpose::STANDARD.decode(input).map_err(|e| D::Error::custom(format!("failure: {e:?}")))?;
    Ok(bytes)
}

fn serialize_base64_string<S>(data: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
    use base64::{Engine as _, engine::{general_purpose}};

    let mut buf = String::new();
    general_purpose::STANDARD.encode_string(data, &mut buf);

    buf.serialize(serializer)
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct SegmentPayload{
    /// The points of interest to segment with.
    points: Vec<segment::Point>,
    /// The data representing the image (base64 string on the wire).
    #[serde(deserialize_with = "deserialize_base64_string")]
    #[serde(serialize_with = "serialize_base64_string")]
    image: Vec<u8>,
    /// The threshold to use.
    #[serde(default)]
    threshold: f64,
}

struct Backend {
    sam: SegmentAnything,
}

impl Backend {
    pub fn new() -> Result<Self, BackendError> {
        let sam = SegmentAnything::new()?;
        Ok(Backend {sam})
    }

    pub fn request_file(&self, rq: &Request) -> Result<Option<ResponseBox>, BackendError> {
        
        let url = rq.url().to_string();
        let path = url.strip_prefix("/").unwrap();
        let path = if path == "" {
            "sieve_interface.html"
        } else {
            path
        };
        // let path = self.frontend_root.join(Path::new(&path));
        let path = Path::new(&path);
        if !path.is_file() {
            return Ok(None);
        }
        let file = fs::File::open(&path);

        if file.is_ok() {
            return Ok(Some(file_to_response(&path, file.unwrap()).boxed()));
        } else {
            return Err("could not open file".into());
        }
    }


    pub fn backend_api(&self, rq: &mut Request) -> Result<Option<ResponseBox>, BackendError> {
        let url = rq.url().to_string();
        let path = url.strip_prefix("/").unwrap();
        Ok(match path {
            "backend/foo" => {
                let f = Foo{z: 3};
                // let stats = self.stats.to_plain();
                Some(
                    tiny_http::Response::from_string(serde_json::to_string_pretty(&f).unwrap())
                        .with_status_code(tiny_http::StatusCode(200))
                        .boxed(),
                )
            }
            "backend/sam_trigger" => {
                // Handle the preflight request here.
                if rq.method() != &Method::Post {
                    return Ok(Some(tiny_http::Response::from_string(serde_json::to_string_pretty("").unwrap())
                        .with_status_code(tiny_http::StatusCode(200)).allow_cors()
                        .boxed()));
                }

                let mut content = String::new();
                rq.as_reader().read_to_string(&mut content)?;
                let r: SegmentPayload = serde_json::from_str(&content)?;

                let segment_res = self.sam.segment(&r.image, r.threshold, &r.points)?;

                let mut res: SegmentPayload  = r.clone();
                res.image = segment_res.image;
                Some(
                    tiny_http::Response::from_string(serde_json::to_string_pretty(&res).unwrap())
                        .with_status_code(tiny_http::StatusCode(200))
                        .boxed(),
                )
            }
            _ => None,
        }.map(|z| z.allow_cors()))
    }
}

pub fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let v = tiny_http::Server::http("0.0.0.0:8081")?;
    let server = Arc::new(v);
    let port = server.server_addr().to_ip().unwrap().port();
    println!("Now listening on port {}", port);

    let backend = Arc::new(Backend::new(
    )?);

    // Serve the webserver with 4 threads.
    let mut handles = Vec::new();
    for _ in 0..4 {
        let server = server.clone();
        let backend = backend.clone();

        handles.push(thread::spawn(move || {
            for mut rq in server.incoming_requests() {
                // println!("{:?}", rq);

                type Handler<'a> =
                    &'a dyn Fn(&mut Request) -> Result<Option<ResponseBox>, BackendError>;

                let order: [Handler; 2] =
                    [&|r| backend.request_file(r), &|r| backend.backend_api(r)];

                let url = rq.url().to_string();

                let mut r = vec![];
                for t in order {
                    let z = t(&mut rq);
                    let served = if z.is_ok() {
                        z.as_ref().ok().unwrap().is_some() == true
                    } else {
                        false
                    };

                    r.push(z);
                    if served {
                        break;
                    }
                }

                if !r
                    .iter()
                    .map(|v| {
                        if v.is_ok() {
                            v.as_ref().ok().unwrap().is_some()
                        } else {
                            true // error, it was definitely handled, but something went bad.
                        }
                    })
                    .any(|v| v)
                {
                    let rep = tiny_http::Response::from_string("Nothing handles this request")
                        .with_status_code(tiny_http::StatusCode(500));
                    let _ = rq.respond(rep);
                    println!("Nothing handled this request: {url:?}");
                    continue;
                }

                for z in r {
                    match z {
                        Err(e) => {
                            let rep = tiny_http::Response::from_string(format!("{:?}", e))
                                .with_status_code(tiny_http::StatusCode(500));
                            println!("Error {url:?}-> {e:?}");
                            let _ = rq.respond(rep);

                            break;
                        }
                        Ok(v) => {
                            if let Some(v) = v {
                                let _ = rq.respond(v);
                                break;
                            }
                        }
                    }
                }
            }
        }));
    }

    for h in handles {
        h.join().unwrap();
    }
    Ok(())
}
