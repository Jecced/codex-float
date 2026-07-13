use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use chrono::{DateTime, Datelike, Local, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;

const RECENT_FILE_AGE: Duration = Duration::from_secs(36 * 60 * 60);
const MAX_SESSION_FILES: usize = 128;
const ACTIVE_STALE_AFTER: chrono::Duration = chrono::Duration::hours(6);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalActivityStats {
    pub enabled: bool,
    pub available: bool,
    pub is_active: bool,
    pub active_since: Option<String>,
    pub today_new_tokens: u64,
    pub context_percent: Option<f64>,
    pub updated_at: String,
}

impl LocalActivityStats {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            available: false,
            is_active: false,
            active_since: None,
            today_new_tokens: 0,
            context_percent: None,
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Default)]
struct SessionActivity {
    active_since: Option<DateTime<Utc>>,
    last_event: Option<DateTime<Utc>>,
}

#[derive(Debug)]
enum SessionEvent {
    Started,
    Finished,
    Tokens {
        new_tokens: u64,
        context_percent: Option<f64>,
    },
}

#[derive(Debug)]
struct ParsedEvent {
    timestamp: DateTime<Utc>,
    event: SessionEvent,
}

pub struct LocalActivityTracker {
    day: NaiveDate,
    offsets: HashMap<String, u64>,
    sessions: HashMap<String, SessionActivity>,
    today_new_tokens: u64,
    latest_context: Option<(DateTime<Utc>, f64)>,
    has_data: bool,
}

impl Default for LocalActivityTracker {
    fn default() -> Self {
        Self {
            day: Local::now().date_naive(),
            offsets: HashMap::new(),
            sessions: HashMap::new(),
            today_new_tokens: 0,
            latest_context: None,
            has_data: false,
        }
    }
}

impl LocalActivityTracker {
    pub fn refresh(&mut self) -> LocalActivityStats {
        let today = Local::now().date_naive();
        if self.day != today {
            self.day = today;
            self.offsets.clear();
            self.sessions.clear();
            self.today_new_tokens = 0;
            self.latest_context = None;
            self.has_data = false;
        }

        let Some(home) = codex_home() else {
            return self.snapshot();
        };
        for path in recent_session_files(&home) {
            self.read_appended_events(&path);
        }
        self.snapshot()
    }

    fn read_appended_events(&mut self, path: &Path) {
        let key = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        if key.is_empty() {
            return;
        }

        let Ok(mut file) = File::open(path) else {
            return;
        };
        let length = file.metadata().map(|value| value.len()).unwrap_or(0);
        let mut offset = self.offsets.get(&key).copied().unwrap_or(0);
        if offset > length {
            offset = 0;
        }
        if file.seek(SeekFrom::Start(offset)).is_err() {
            return;
        }

        let mut reader = BufReader::new(file);
        loop {
            let mut line = String::new();
            let Ok(bytes_read) = reader.read_line(&mut line) else {
                break;
            };
            if bytes_read == 0 {
                break;
            }
            if !line.ends_with('\n') {
                break;
            }
            offset = offset.saturating_add(bytes_read as u64);
            let Some(event) = parse_event_line(&line) else {
                continue;
            };
            self.apply_event(&key, event);
        }
        self.offsets.insert(key, offset);
    }

    fn apply_event(&mut self, session: &str, parsed: ParsedEvent) {
        self.has_data = true;
        match parsed.event {
            SessionEvent::Started => {
                let activity = self.sessions.entry(session.to_string()).or_default();
                activity.active_since = Some(parsed.timestamp);
                activity.last_event = Some(parsed.timestamp);
            }
            SessionEvent::Finished => {
                let activity = self.sessions.entry(session.to_string()).or_default();
                activity.active_since = None;
                activity.last_event = Some(parsed.timestamp);
            }
            SessionEvent::Tokens {
                new_tokens,
                context_percent,
            } => {
                self.sessions
                    .entry(session.to_string())
                    .or_default()
                    .last_event = Some(parsed.timestamp);
                if parsed.timestamp.with_timezone(&Local).date_naive() == self.day {
                    self.today_new_tokens = self.today_new_tokens.saturating_add(new_tokens);
                }
                if let Some(percent) = context_percent {
                    let replace = self
                        .latest_context
                        .as_ref()
                        .is_none_or(|(timestamp, _)| parsed.timestamp >= *timestamp);
                    if replace {
                        self.latest_context = Some((parsed.timestamp, percent));
                    }
                }
            }
        }
    }

    fn snapshot(&self) -> LocalActivityStats {
        let active_since = self
            .sessions
            .values()
            .filter(|session| {
                session.last_event.as_ref().is_some_and(|value| {
                    Utc::now().signed_duration_since(*value) <= ACTIVE_STALE_AFTER
                })
            })
            .filter_map(|session| session.active_since.as_ref())
            .min()
            .cloned();
        LocalActivityStats {
            enabled: true,
            available: self.has_data,
            is_active: active_since.is_some(),
            active_since: active_since.map(|value| value.to_rfc3339()),
            today_new_tokens: self.today_new_tokens,
            context_percent: self.latest_context.as_ref().map(|(_, percent)| *percent),
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

fn codex_home() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
}

fn recent_session_files(home: &Path) -> Vec<PathBuf> {
    let mut output = Vec::new();
    let today = Local::now().date_naive();
    for date in [today, today - chrono::Duration::days(1)] {
        let directory = home
            .join("sessions")
            .join(format!("{:04}", date.year()))
            .join(format!("{:02}", date.month()))
            .join(format!("{:02}", date.day()));
        collect_jsonl(&directory, &mut output, 0);
    }
    collect_jsonl(&home.join("sessions"), &mut output, 6);
    collect_jsonl(&home.join("archived_sessions"), &mut output, 0);
    output.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|value| value.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });
    output.reverse();
    output.truncate(MAX_SESSION_FILES);
    output
}

fn collect_jsonl(directory: &Path, output: &mut Vec<PathBuf>, depth: usize) {
    if output.len() >= MAX_SESSION_FILES {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && depth < 6 {
            collect_jsonl(&path, output, depth + 1);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        let recent = entry
            .metadata()
            .and_then(|value| value.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age <= RECENT_FILE_AGE);
        if recent {
            output.push(path);
        }
        if output.len() >= MAX_SESSION_FILES {
            return;
        }
    }
}

fn parse_event_line(line: &str) -> Option<ParsedEvent> {
    if !line.contains("\"token_count\"")
        && !line.contains("\"task_started\"")
        && !line.contains("\"task_complete\"")
        && !line.contains("\"turn_aborted\"")
        && !line.contains("\"task_cancelled\"")
    {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("event_msg") {
        return None;
    }
    let timestamp = DateTime::parse_from_rfc3339(value.get("timestamp")?.as_str()?)
        .ok()?
        .with_timezone(&Utc);
    let payload = value.get("payload")?;
    let event_type = payload.get("type")?.as_str()?;
    let event = match event_type {
        "task_started" => SessionEvent::Started,
        "task_complete" | "turn_aborted" | "task_cancelled" => SessionEvent::Finished,
        "token_count" => {
            let info = payload.get("info")?;
            let usage = info.get("last_token_usage")?;
            let input = usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let cached = usage
                .get("cached_input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                .min(input);
            let output = usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let context_window = info
                .get("model_context_window")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let context_percent = (context_window > 0)
                .then_some((input as f64 / context_window as f64 * 100.0).clamp(0.0, 100.0));
            SessionEvent::Tokens {
                new_tokens: input.saturating_sub(cached).saturating_add(output),
                context_percent,
            }
        }
        _ => return None,
    };
    Some(ParsedEvent { timestamp, event })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_task_lifecycle_without_reading_message_events() {
        let started = parse_event_line(
            r#"{"timestamp":"2026-07-11T16:23:11Z","type":"event_msg","payload":{"type":"task_started"}}"#,
        )
        .expect("task start should parse");
        assert!(matches!(started.event, SessionEvent::Started));
        assert!(parse_event_line(
            r#"{"timestamp":"2026-07-11T16:23:11Z","type":"response_item","payload":{"type":"message","text":"private"}}"#
        )
        .is_none());
    }

    #[test]
    fn counts_only_uncached_input_plus_output() {
        let parsed = parse_event_line(
            r#"{"timestamp":"2026-07-11T16:24:00Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000,"cached_input_tokens":800,"output_tokens":50,"reasoning_output_tokens":20,"total_tokens":1050},"model_context_window":4000}}}"#,
        )
        .expect("token event should parse");
        match parsed.event {
            SessionEvent::Tokens {
                new_tokens,
                context_percent,
            } => {
                assert_eq!(new_tokens, 250);
                assert_eq!(context_percent, Some(25.0));
            }
            _ => panic!("expected token event"),
        }
    }

    #[test]
    fn tracks_active_lifecycle_and_today_total() {
        let now = Utc::now();
        let mut tracker = LocalActivityTracker::default();
        tracker.apply_event(
            "session",
            ParsedEvent {
                timestamp: now,
                event: SessionEvent::Started,
            },
        );
        tracker.apply_event(
            "session",
            ParsedEvent {
                timestamp: now,
                event: SessionEvent::Tokens {
                    new_tokens: 420,
                    context_percent: Some(18.5),
                },
            },
        );
        let active = tracker.snapshot();
        assert!(active.is_active);
        assert_eq!(active.today_new_tokens, 420);
        assert_eq!(active.context_percent, Some(18.5));

        tracker.apply_event(
            "session",
            ParsedEvent {
                timestamp: now,
                event: SessionEvent::Finished,
            },
        );
        assert!(!tracker.snapshot().is_active);
    }
}
