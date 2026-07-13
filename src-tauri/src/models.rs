use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
    pub window_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub provider: String,
    pub display_name: String,
    pub plan: Option<String>,
    pub short_window: Option<UsageWindow>,
    pub weekly_window: Option<UsageWindow>,
    pub reset_credits: Option<u64>,
    pub reset_credit_expires_at: Vec<String>,
    pub updated_at: String,
    pub status: String,
    pub message: Option<String>,
}

impl ProviderSnapshot {
    pub fn failure(status: &str, message: &str) -> Self {
        Self {
            provider: "codex".into(),
            display_name: "CODEX".into(),
            plan: None,
            short_window: None,
            weekly_window: None,
            reset_credits: None,
            reset_credit_expires_at: Vec::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            status: status.into(),
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPreferences {
    pub locked: bool,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    pub pinned_provider: Option<String>,
    pub auto_rotate_seconds: u64,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_local_activity_stats")]
    pub local_activity_stats: bool,
    #[serde(default = "default_weekly_only")]
    pub weekly_only: bool,
    #[serde(default = "default_show_percentage_decimals")]
    pub show_percentage_decimals: bool,
}

fn default_always_on_top() -> bool { true }
fn default_language() -> String { "zh-CN".into() }
fn default_local_activity_stats() -> bool { true }
fn default_weekly_only() -> bool { true }
fn default_show_percentage_decimals() -> bool { true }

impl Default for WidgetPreferences {
    fn default() -> Self {
        Self { locked: false, always_on_top: true, pinned_provider: None, auto_rotate_seconds: 12, language: default_language(), local_activity_stats: default_local_activity_stats(), weekly_only: default_weekly_only(), show_percentage_decimals: default_show_percentage_decimals() }
    }
}

impl WidgetPreferences {
    pub fn normalized(mut self) -> Self {
        self.auto_rotate_seconds = self.auto_rotate_seconds.clamp(5, 300);
        if self.pinned_provider.as_deref() != Some("codex") {
            self.pinned_provider = None;
        }
        if self.language != "en" && self.language != "zh-CN" {
            self.language = default_language();
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enables_new_display_preferences_for_existing_settings() {
        let preferences: WidgetPreferences = serde_json::from_value(serde_json::json!({
            "locked": false,
            "alwaysOnTop": true,
            "pinnedProvider": null,
            "autoRotateSeconds": 12,
            "language": "zh-CN",
            "localActivityStats": true
        }))
        .unwrap();

        assert!(preferences.weekly_only);
        assert!(preferences.show_percentage_decimals);
    }
}
