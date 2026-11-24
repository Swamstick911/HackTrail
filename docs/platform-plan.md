# Shared platform build

The target is a dependable daily tracker and shared platform. Hackatime is the comparison point for account setup, project statistics, privacy settings, editor support, public profiles, and integration APIs. HackTrail adds explicit separation of editor and agent time, Git context, and inspectable evidence. Feature parity is not a claim of equal reliability or approved productive-struggle measurement.

The original eleven requirements in the [bounty roadmap](bounty-roadmap.md#original-requirements) define the current scope. Prioritize tracking correctness and the existing submission evidence flow. A separate organizer management system and additional creative features are deferred.

## Implemented foundation

1. Account isolation, maintained authentication, persistent sessions, scoped API keys, and private server storage.
2. Project management, account time zones, daily/project/language statistics, goals, public profile controls, and opt-in community statistics.
3. Device authorization and durable local-to-platform sync with visible status, retries, revocation, and no automatic transfer of conversation excerpts.
4. A WakaTime-compatible heartbeat entry point, with heartbeat-derived estimates distinguished from direct editor samples.
5. Selected-period reports with explicit disclosure preview, expiring access, revocation, and reproducible JSON exports.
6. Automated installation, migration, account isolation, and browser workflow checks across multiple accounts and devices.

## Next implementation order

1. Reproduce and fix errors at activity, idle, sleep, focus, and offline boundaries without changing the counting policy silently.
2. Validate installation and everyday tracking on the supported operating systems, including the low-spec Dell.
3. Make the adapter contract usable for additional popular editors and AI harnesses.
4. Check that external reviewers can reproduce submitted intervals and understand missing evidence using the existing reports.
5. Measure server capacity and hosting cost at the bounty's stated load before a program pilot.

## Architecture

Keep the TypeScript, Fastify, React, and SQLite stack. The local collector remains a loopback-only process; the shared platform is a separate server with account authentication and its own database. It can run on a single persistent host for development and pilot use. The production origin must use HTTPS. SQLite is a starting deployment choice, not evidence that the bounty's full traffic target has been met.

Use Better Auth for account credentials, sessions, password changes, and email recovery when SMTP is configured. Device/API credentials are scoped, revocable, and stored as hashes on the platform. The extension uses VS Code secret storage for its device credential. Programs never receive a participant's collector token.

All project, event, pause, overlap, and report queries must be scoped to the authenticated account. Simultaneous work by different people must never reduce each other's recorded time. Multiple devices belonging to one account must not double count overlapping time.

Profiles can be public while project details and raw activity remain private. Automatically synced project names start private. Public totals include only deliberately published projects. Sharing a report is a separate, explicit disclosure. Local notes and imported text do not leave the collector automatically.

## Release gates

Automated checks must cover account separation, session and key revocation, origin checks, duplicate and conflicting uploads, offline retry, midnight/time-zone boundaries, paused time, concurrent devices, visibility changes, report disclosure and expiry, and local database migration. Browser checks must exercise real persisted data rather than mock statistics. Add meaningful cases toward the requested broad test coverage instead of tests that merely mirror implementation.

Keep source code readable, commit working milestones using conventional commits, and preserve existing local data. Do not publish to a live program before the real-device and reference-session checks. OAuth provider registrations, mail delivery, hosting capacity, and actual organizer adoption need their own verified configuration and validation.

## References checked November 23, 2026

- [Hackatime documentation](https://hackatime.hackclub.com/docs): editor ecosystem and setup.
- [Hackatime configuration](https://hackatime.hackclub.com/docs/configuration): account time zones, project and privacy controls.
- [Hackatime OAuth](https://hackatime.hackclub.com/docs/oauth/oauth-apps): scoped integration access.
- [Better Auth Fastify integration](https://better-auth.com/docs/integrations/fastify) and [SQLite support](https://better-auth.com/docs/adapters/sqlite).
