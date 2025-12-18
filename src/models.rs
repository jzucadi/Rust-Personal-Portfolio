use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct JobEntry {
    #[allow(dead_code)]
    pub key: u32,
    pub name: String,
    pub details: String,
    pub tools: String,
    pub screen: String,
    pub link: String,
}

#[derive(Debug, Deserialize)]
pub struct JobData {
    pub entries: Vec<JobEntry>,
}
