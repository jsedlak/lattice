pub mod chat;
pub mod docs;
pub mod embedding;
pub mod graph;
pub mod settings;
pub mod workspace;

/// Commands surface errors to the webview as strings.
pub type CmdResult<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
