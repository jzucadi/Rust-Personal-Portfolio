mod models;

use anyhow::{Context, Result};
use askama::Template;
use axum::{
    extract::State,
    http::{header, HeaderValue},
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use models::{JobData, JobEntry};
use std::{env, fs, sync::Arc};
use tower_http::{services::ServeDir, set_header::SetResponseHeaderLayer};
use tracing_subscriber::EnvFilter;

#[derive(Template)]
#[template(path = "index.html")]
struct IndexTemplate<'a> {
    jobs: &'a [JobEntry],
    year: i32,
}

struct AppState {
    jobs: Vec<JobEntry>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing with configurable log level via RUST_LOG env var
    // Example: RUST_LOG=debug cargo run
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let job_data = load_jobs().context("Failed to load job data from db.json")?;

    let state = Arc::new(AppState {
        jobs: job_data.entries,
    });

    let [h1, h2, h3, h4] = security_headers();
    let app = Router::new()
        .route("/", get(index_handler))
        .route("/health", get(health_handler))
        .nest_service("/static", ServeDir::new("static"))
        .layer(h1)
        .layer(h2)
        .layer(h3)
        .layer(h4)
        .with_state(state);

    let addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Failed to bind to {}", addr))?;

    tracing::info!("Server listening on http://{}", addr);

    axum::serve(listener, app)
        .await
        .context("Server error")?;

    Ok(())
}

fn security_headers() -> [SetResponseHeaderLayer<HeaderValue>; 4] {
    [
        SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ),
        SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ),
        SetResponseHeaderLayer::overriding(
            header::X_XSS_PROTECTION,
            HeaderValue::from_static("1; mode=block"),
        ),
        SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ),
    ]
}

async fn index_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let current_year = chrono::Datelike::year(&chrono::Local::now());

    let template = IndexTemplate {
        jobs: &state.jobs,
        year: current_year,
    };

    match template.render() {
        Ok(html) => Html(html).into_response(),
        Err(err) => {
            tracing::error!("Template rendering error: {}", err);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Internal Server Error",
            )
                .into_response()
        }
    }
}

async fn health_handler() -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "status": "healthy"
    }))
}

fn load_jobs() -> Result<JobData> {
    let data = fs::read_to_string("db.json").context("Could not read db.json")?;
    parse_job_data(&data)
}

fn parse_job_data(json: &str) -> Result<JobData> {
    serde_json::from_str(json).context("Invalid JSON in db.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn sample_job() -> JobEntry {
        JobEntry {
            key: 1,
            name: "Test Company".to_string(),
            details: "Test details".to_string(),
            tools: "Rust, Axum".to_string(),
            screen: "/test.png".to_string(),
            link: "https://example.com".to_string(),
        }
    }

    #[test]
    fn test_parse_valid_json() {
        let json = r#"{
            "entries": [{
                "key": 1,
                "name": "Test Company",
                "details": "Test details",
                "tools": "Rust",
                "screen": "/test.png",
                "link": "https://example.com"
            }]
        }"#;

        let result = parse_job_data(json);
        assert!(result.is_ok());

        let job_data = result.unwrap();
        assert_eq!(job_data.entries.len(), 1);
        assert_eq!(job_data.entries[0].name, "Test Company");
    }

    #[test]
    fn test_parse_multiple_entries() {
        let json = r#"{
            "entries": [
                {"key": 1, "name": "Company A", "details": "A", "tools": "A", "screen": "/a.png", "link": "https://a.com"},
                {"key": 2, "name": "Company B", "details": "B", "tools": "B", "screen": "/b.png", "link": "https://b.com"}
            ]
        }"#;

        let result = parse_job_data(json);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().entries.len(), 2);
    }

    #[test]
    fn test_parse_empty_entries() {
        let json = r#"{"entries": []}"#;

        let result = parse_job_data(json);
        assert!(result.is_ok());
        assert!(result.unwrap().entries.is_empty());
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not valid json";
        let result = parse_job_data(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_missing_field() {
        let json = r#"{
            "entries": [{
                "key": 1,
                "name": "Test"
            }]
        }"#;

        let result = parse_job_data(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_template_renders() {
        let jobs = vec![sample_job()];
        let template = IndexTemplate {
            jobs: &jobs,
            year: 2024,
        };

        let result = template.render();
        assert!(result.is_ok());

        let html = result.unwrap();
        assert!(html.contains("Test Company"));
        assert!(html.contains("2024"));
    }

    #[test]
    fn test_template_renders_empty_jobs() {
        let jobs: Vec<JobEntry> = vec![];
        let template = IndexTemplate {
            jobs: &jobs,
            year: 2024,
        };

        let result = template.render();
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_index_handler_returns_200() {
        let state = Arc::new(AppState {
            jobs: vec![sample_job()],
        });

        let app = Router::new()
            .route("/", get(index_handler))
            .with_state(state);

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn test_index_handler_returns_html() {
        let state = Arc::new(AppState {
            jobs: vec![sample_job()],
        });

        let app = Router::new()
            .route("/", get(index_handler))
            .with_state(state);

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let html = String::from_utf8(body.to_vec()).unwrap();

        assert!(html.contains("<!DOCTYPE html>") || html.contains("<html"));
        assert!(html.contains("Test Company"));
    }

    #[tokio::test]
    async fn test_index_handler_empty_jobs() {
        let state = Arc::new(AppState { jobs: vec![] });

        let app = Router::new()
            .route("/", get(index_handler))
            .with_state(state);

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn test_404_for_unknown_route() {
        let state = Arc::new(AppState { jobs: vec![] });

        let app = Router::new()
            .route("/", get(index_handler))
            .with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_health_endpoint_returns_200() {
        let state = Arc::new(AppState { jobs: vec![] });

        let app = Router::new()
            .route("/health", get(health_handler))
            .with_state(state);

        let response = app
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn test_health_endpoint_returns_json() {
        let state = Arc::new(AppState { jobs: vec![] });

        let app = Router::new()
            .route("/health", get(health_handler))
            .with_state(state);

        let response = app
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["status"], "healthy");
    }

    #[tokio::test]
    async fn test_security_headers_present() {
        let state = Arc::new(AppState { jobs: vec![] });

        let [h1, h2, h3, h4] = security_headers();
        let app = Router::new()
            .route("/", get(index_handler))
            .layer(h1)
            .layer(h2)
            .layer(h3)
            .layer(h4)
            .with_state(state);

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response.headers().get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
            "nosniff"
        );
        assert_eq!(
            response.headers().get(header::X_FRAME_OPTIONS).unwrap(),
            "DENY"
        );
        assert_eq!(
            response.headers().get(header::X_XSS_PROTECTION).unwrap(),
            "1; mode=block"
        );
        assert_eq!(
            response.headers().get(header::REFERRER_POLICY).unwrap(),
            "strict-origin-when-cross-origin"
        );
    }
}
