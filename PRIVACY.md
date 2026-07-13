# Privacy

Codex Float is designed to be local-first and minimal.

## What It Reads

- The app reads the local Codex Desktop login file from `CODEX_HOME/auth.json` or the user's `.codex/auth.json`.
- The app sends the existing Codex access token only to the ChatGPT quota endpoints needed to read Codex usage.
- The app may read the account identifier from the login file or token payload only to set the request header expected by the quota service.
- When **Local activity stats** is enabled, the app incrementally reads recent Codex session JSONL files under `CODEX_HOME/sessions` and `CODEX_HOME/archived_sessions`.
- The local activity reader only recognizes task lifecycle and `token_count` event lines. It does not deserialize, display, copy, or retain prompt, response, reasoning, or tool-output events.

## What It Stores

Codex Float stores only widget preferences in its own application config directory:

- locked state
- always-on-top state
- pinned provider
- auto-rotate interval
- language
- whether local activity stats are enabled

Token totals, activity state, and context usage are kept in memory and rebuilt from the current day's local events after restart. They are not written to Codex Float's config directory.

The app does not copy or persist Codex tokens, account IDs, raw quota responses, user prompts, chat history, session contents, or local session paths.

## What It Sends

The app only calls these quota-related HTTPS endpoints from the local desktop process:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

No telemetry, analytics, crash reporting, or third-party tracking is included.
Local activity statistics never leave the device.

## Logging

Logs are intentionally generic. They must not include tokens, account IDs, raw backend responses, request headers, local auth paths, or personal file paths.

## Accuracy Boundary

Codex Float displays quota windows returned by the Codex quota service. It does not estimate quota from local token usage and does not fabricate values when the response shape is unknown.

The local "Today Token" value is a separate device-local productivity statistic. It is calculated as non-cached input plus output tokens from Codex session events, uses the computer's local midnight as its boundary, and is not a billing or quota-service value. Codex's internal session event format may change; when unavailable, the widget omits local statistics instead of treating them as quota data.
