# HackTrail

See how your projects take shape.

A local project activity journal for AI-assisted work. Phase 1 provides a typed collector, SQLite storage, explicit transcript import, and an inspectable timeline.

Recorded activity does not establish human presence or productive-struggle hours. Phase 1 does not award time credit.

## Run locally

Install Node.js 26 and Git, then run these commands in a terminal. They also work in Windows PowerShell.

```sh
git clone https://github.com/Swamstick911/HackTrail.git
cd HackTrail
npm ci
npm run build
npm start
```

Open http://127.0.0.1:47654 in your browser. Keep the terminal open while using HackTrail. Press Ctrl+C to stop it.

There is no account setup, Docker service, or API key to buy. The built application runs locally without an internet connection. Installing dependencies requires internet access.

## Start a trail

1. Create a project, or choose **Explore an example** to try labeled synthetic activity.
2. Select **Import activity** and choose a Claude Code JSONL transcript, up to 10 MB.
3. Preview the import, then confirm it. Message excerpts are optional and off by default.
4. Filter the timeline, search activity, and select an event to inspect its source reference.
5. Use **Export JSON** when you want a copy of the recorded project activity.

Claude Code transcripts normally live under `~/.claude/projects/`. On Windows, look under `%USERPROFILE%\.claude\projects\` or the home directory of the environment where Claude runs. Choose an individual session file. HackTrail does not scan these folders.

Reimporting an unchanged file skips duplicates. An appended file adds new events. Keep the file name, existing lines, and excerpt setting unchanged when reimporting. If an existing event changes, the whole import is rejected instead of silently replacing evidence. Import a changed copy into a new project.

The importer keeps event types, timestamps, tool names, model labels, and file/line references. It ignores model reasoning and does not store tool inputs or outputs. When enabled, excerpts retain at most 500 characters per message. The original transcript is not copied into the database.

## Local data

HackTrail stores its SQLite database and local access token in `.hacktrail/` inside the directory from which you start it. This directory is ignored by Git.

| Setting              | Default      | Purpose                       |
| -------------------- | ------------ | ----------------------------- |
| `HACKTRAIL_DATA_DIR` | `.hacktrail` | Choose another data directory |
| `HACKTRAIL_PORT`     | `47654`      | Choose another loopback port  |

The collector listens on `127.0.0.1` and checks request hosts and origins. Its browser interface obtains the local token automatically. This is a single-user local application, not a public server or an authentication boundary against other programs running on the same machine.

To back up your workspace, stop HackTrail and copy the entire data directory. JSON exports contain normalized events, not a restorable workspace backup. Deleting a project removes its records from HackTrail without editing the original transcripts.

## Development

Run these in separate terminals:

```sh
npm run dev:server
npm run dev:web
```

Open http://127.0.0.1:5173. The development UI proxies requests to the collector's default port.

```sh
npm run check
npx playwright install chromium --only-shell
npm run test:e2e
```

`check` runs formatting checks, type checking, unit/API tests, and a production build. Browser tests use an isolated temporary database on port 47655 and remove it when finished. Use `npm run format` to format edits.

The stack is TypeScript, Fastify, SQLite, and React with Vite. See the [API contract](docs/api.md) and [implementation plan](docs/phase-1.md).

## Phase 1 limits

This release supports explicit Claude transcript imports. Live editor and agent integrations, Git linking, review summaries, accounts, and time estimates come later. User-role messages do not verify human presence; tool results are recorded separately as tool activity.

Automated checks cover macOS, Windows, and Linux in CI. Performance on the Dell Inspiron 5775 still needs an actual device test. Phase 1 is the local foundation, not a complete bounty submission.

Licensed under [GNU AGPLv3](LICENSE).
