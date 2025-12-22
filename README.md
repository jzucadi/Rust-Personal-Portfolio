# Rust Portfolio

A portfolio website built with Rust, Axum, and Askama, recreated my original which was done in nuxt v. 2.

## Features

- **Rust-powered**: Fast, type-safe backend using Rust
- **Axum web framework**: Modern, ergonomic web framework built on tokio
- **Askama templates**: Type-safe template rendering
- **Static file serving**: Serves CSS, images, and other assets
- **Dynamic job entries**: Loads portfolio entries from `db.json`

## Project Structure

```
rust-persona/
├── src/
│   ├── main.rs          # Main application entry point
│   └── models.rs        # Data models for job entries
├── templates/
│   ├── base.html        # Base layout template
│   ├── index.html       # Home page template
│   └── partials/
│       └── job.html     # Job entry partial template
├── static/
│   ├── css/
│   │   └── main.css     # Main stylesheet
│   └── images/          # Static images and SVGs
├── db.json              # Job entries database
├── Cargo.toml           # Rust dependencies
└── README.md            # This file
```

## Prerequisites

- Rust 1.70 or later
- Cargo (comes with Rust)

## Installation

1. Clone the repository

2. Build the project:
   ```bash
   cargo build
   ```

## Running the Application

1. Start the server:
   ```bash
   cargo run
   ```

2. Open your browser and navigate to:
   ```
   http://127.0.0.1:3000
   ```

## Development

To run in development mode with auto-reloading, you can use `cargo-watch`:

```bash
cargo install cargo-watch
cargo watch -x run
```

## Modifying Job Entries

Edit the `db.json` file to add, remove, or modify portfolio entries. The file structure is:

```json
{
  "entries": [
    {
      "key": 1,
      "name": "Project Name",
      "details": "Project description",
      "tools": "Technologies used",
      "screen": "/image-path.png",
      "link": "https://project-url.com/"
    }
  ]
}
```

Restart the server after making changes to see them reflected.

## Technologies Used

- **Rust**: Systems programming language
- **Axum**: Web framework
- **Askama**: Type-safe template engine
- **Tokio**: Async runtime
- **Tower-HTTP**: HTTP middleware and utilities
- **Serde**: Serialization/deserialization
- **Chrono**: Date and time library


