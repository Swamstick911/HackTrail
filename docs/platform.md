# Running the shared platform

HackTrail 0.5 includes a multiuser server alongside the existing local collector. The collector keeps working offline. The platform stores accounts, synced project activity, profile settings, and report snapshots in its own data directory.

## Try it locally

Install Node.js 26, then run:

```sh
npm ci
npm run build
npm run start:platform
```

Open http://127.0.0.1:47657 and create an account. The development server generates a persistent authentication secret in `.hacktrail-platform/auth.secret`. Do not delete that file between starts. Email verification and recovery are available when SMTP is configured; without SMTP this is a local development setup.

The old `npm start` command still opens the local collector at http://127.0.0.1:47654. Its existing database is preserved. The shared platform does not import it or expose its access token.

## Connect VS Code

1. Open **Connections** and download the extension, or use `releases/hacktrail.vsix` from the build.
2. Install it through **Extensions: Install from VSIX**, then reload VS Code.
3. Enable local tracking for your project. Choose Git, Claude, and Codex collection independently.
4. Run **HackTrail: Connect Account**. Enter the platform address, choose which optional metadata to sync, and approve the displayed code in your browser.
5. Return to your editor. Synced projects start private. Use the platform's project settings to add repository/demo links or publish a project.

The credential is held in VS Code SecretStorage. The browser approval grants activity uploads only; it does not grant account management or access to other records. **HackTrail: Open Platform** opens the account dashboard. The status-bar tooltip shows sync status. A connection is specific to the current workspace; connecting another workspace requires its own approval.

**HackTrail: Disconnect Account** stops uploads and attempts to revoke that device. If the server is offline, remove its key from **Connections** when you can reach it. Local tracking continues. You can also revoke a device immediately from the platform.

## What leaves the computer

Editor sync includes the project name, counted intervals, input signal type, language, and editor name. Optional agent sync includes lifecycle timestamps, source, tool names, and outcomes. Optional Git sync includes commit IDs, branch names, and aggregate changes. These choices are separate from local collection settings.

Local notes, prompt excerpts, tool arguments, outputs, source code, and transcript filenames are not automatically uploaded. Notes written on the platform are stored on the platform. Publishing a project exposes its description, links, and aggregate statistics, not its raw event trail or notes.

The first sync covers available records from roughly the previous seven days. Older local records remain local and can be exported from the collector. Sync uses a durable increasing cursor and uploads already-counted intervals, so local pauses cannot be credited again. A pending batch is saved before sending, then replayed unchanged after a lost response. Reconnecting resumes the cursor for that account; changed disclosure choices apply to new batches. Previously uploaded records remain unchanged.

Different accounts have independent ledgers. Overlapping devices within an account count once. The account pause excludes editor intervals during the pause, including late uploads. It does not disable local collection or agent hooks. Deleting a platform project prevents background sync from recreating it; create a new local project if you intend to start over.

## Other editors

The WakaTime-compatible receiver accepts single and bulk heartbeats:

- `POST /api/v1/users/current/heartbeats`
- `POST /api/v1/users/current/heartbeats.bulk`

Create a **Send activity only** key in Connections. Configure a plugin that supports a custom endpoint:

```ini
[settings]
api_url = https://trail.example.org/api/v1
api_key = YOUR_HACKTRAIL_KEY
```

Both Bearer authentication and Basic authentication containing the key are accepted. Bulk requests support up to 25 entries and return a status for each entry. Heartbeats older than seven days or more than five seconds in the future are rejected. File paths, branches, dependencies, and unrecognized payload fields are discarded.

These are heartbeat estimates: consecutive points from a device must be at most two minutes apart. An isolated point adds no time. An out-of-order point rebuilds affected intervals, including project changes and pause exclusions. Direct editor samples take precedence when those compatibility intervals are rebuilt. Explicit `ai coding` heartbeats do not become editor time. Other heartbeat categories are not evidence of human authorship. Their signal is identified as `heartbeat` in statistics and exports.

This implements heartbeat ingestion, not the entire WakaTime or Hackatime API. Existing plugins may transmit paths to the endpoint even though HackTrail discards them. Use their privacy options where needed. Individual editors still need real-device validation; API compatibility alone does not certify every plugin.

## Accounts and disclosure

Profiles start public, with an opt-out in Settings. Synced projects start private, and public totals include only published projects. Community-board participation requires a separate opt-in and a public profile. Community rankings use seven UTC calendar days; personal statistics use the account time zone.

Device keys can send activity. Statistics keys can read project metadata and aggregate statistics. Both are stored as hashes, displayed once, scoped, and revocable. Account settings, raw evidence, exports, notes, and reports require a browser session.

Reports are immutable snapshots of a selected period up to 32 days. Preview optional Git and note disclosure before sharing. A changed preview requires another review before a link is created. Start/stop metadata outside the period is included only when needed to establish a crossing run, up to 12 hours away. Counted time is clipped to the selected period.

Share links expire after 1, 7, or 30 days and can be revoked. Anyone with a link can read it. The server stores a hash of the token; the full URL is shown only when created. Revocation cannot erase a downloaded copy. Project or account deletion revokes its reports. A report fingerprint identifies its contents; it does not authenticate authorship or prove eligibility for approved hours.

## Deploy on a persistent host

This server needs a writable persistent disk. GitHub Pages and static hosting cannot run its authenticated API or SQLite databases. Use a Node.js host behind an HTTPS reverse proxy. No public deployment is created by the build or GitHub Actions.

Copy `.env.example` to `.env` and configure it for the host. `npm run start:platform` reads `.env` if present. For production, set:

| Variable                      | Purpose                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV=production`         | Enforce HTTPS, persistent secret, and account mail configuration                |
| `HACKTRAIL_ORIGIN`            | Exact external HTTPS origin, without a trailing slash                           |
| `HACKTRAIL_AUTH_SECRET`       | Random persistent secret of at least 32 characters                              |
| `HACKTRAIL_SMTP_URL`          | SMTP transport URL for verification and recovery                                |
| `HACKTRAIL_MAIL_FROM`         | Sender accepted by your mail provider                                           |
| `HACKTRAIL_PLATFORM_DATA_DIR` | Persistent private directory, default `.hacktrail-platform`                     |
| `HACKTRAIL_PLATFORM_HOST`     | Default `127.0.0.1`; use `0.0.0.0` only when the network boundary is configured |
| `HACKTRAIL_PLATFORM_PORT`     | Internal port, default `47657`                                                  |
| `HACKTRAIL_TRUST_PROXY`       | Optional comma-separated trusted proxy IPs or CIDRs                             |
| `HACKTRAIL_REGISTRATION_OPEN` | Set `false` to close new registrations                                          |

A secret can be generated locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Set the proxy's upstream `Host` to the host portion of `HACKTRAIL_ORIGIN`, and overwrite forwarded client IP headers. Trust only the actual proxy addresses. Without this setting, rate limits use the direct peer IP, which may be shared by everyone behind a proxy. Do not trust arbitrary incoming forwarded headers. Default limits are 300 requests per minute per IP, with tighter authentication and device-start limits.

Run the process under your host's service manager with restart handling and log collection. Health is available at `/api/health`. Verify real email delivery, HTTPS cookies, device approval, restart persistence, backups, and restore on the chosen host before inviting participants. Configure your provider's retention policy for request logs, which can otherwise retain link tokens or incoming heartbeat metadata.

Stop the platform before copying its entire data directory and authentication secret for a consistent backup. Keep backups private. Restore both `auth.sqlite` and `activity.sqlite` together, including any SQLite sidecar files present in the stopped backup. JSON project/report exports are inspection records, not restorable server backups. Keep one server process per database directory; do not place SQLite on a shared network filesystem or ephemeral function storage.

## Verification and remaining release gates

```sh
npm run check
npx playwright install chromium --only-shell
npm run test:e2e
npm run test:e2e:platform
```

The platform browser suite uses temporary servers on ports 47658 and 47659. It exercises real accounts and databases, browser device approval, collector-to-platform sync, project privacy, report sharing/revocation, account deletion, and mobile layouts. The existing collector browser suite remains separate.

The GitHub workflow runs formatting, TypeScript, tests, and builds on Linux, Windows, and macOS, plus both browser suites on Linux. A green workflow is a development release gate, not a live YSWS approval.

Still required before a program pilot: reference-session validation of the counting policy, tests on the Dell Inspiron 5775 and other target devices, validation of remote editor environments, independent security review, measured capacity/cost at the bounty traffic target, and explicit organizer acceptance. No production SMTP delivery, live program integration, official approved-hours ledger, or Unified database submission is claimed by this release.
