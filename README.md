# HackTrail

Local time tracking and a project journal for people building with AI.

HackTrail estimates editor activity from VS Code, collects Claude Code events live, and keeps your notes alongside the work. Editor time and agent time stay separate.

## Run locally

Install Node.js 26 and Git. These commands also work in Windows PowerShell:

```sh
git clone https://github.com/Swamstick911/HackTrail.git
cd HackTrail
npm ci
npm run build
npm start
```

Open http://127.0.0.1:47654. Keep the terminal open while using HackTrail. Press Ctrl+C to stop it.

The build creates the dashboard, collector, Claude adapter, and an installable VS Code extension. No cloud API key or separate database service is needed. Installation requires internet access; the built application works locally.

## Connect VS Code

1. Create a project in the dashboard.
2. Select **Connect VS Code** and download the extension.
3. In VS Code's command palette, run **Extensions: Install from VSIX** and choose the downloaded file.
4. Open your project folder. Run **HackTrail: Connect This Workspace**, accept the local collector address, and choose your project.
5. Start editing. The status bar shows tracking, idle, paused, or offline. Dashboard totals update every few seconds.

The package is also available at `releases/hacktrail.vsix` after building. Compatible Cursor versions can install the same package. The extension requires VS Code 1.100 or newer and a trusted workspace.

For SSH, WSL, and containers, run the collector in the same environment as the extension host. It connects only to a loopback address.

## How time works

- Keyboard and mouse selection signals in the connected workspace start an activity window.
- Switching away stops counting. Two minutes without another input signal ends the window.
- Samples upload every 15 seconds. Sleep or scheduling gaps longer than 30 seconds are skipped.
- Overlapping windows count once, including across projects. The first accepted sample gets the overlapping time.
- Dashboard pause excludes the paused interval, including samples uploaded later.
- Offline samples retry automatically. The local queue holds up to 5,000 samples; samples older than seven days expire.

This is an estimate of editor activity, not verified human working time. Focus alone, file changes made by an agent, and agent runtime do not earn editor time. Reading without interaction, terminal work, planning, and testing elsewhere can be missed. Add a project note to keep that context.

Use the dashboard's **How is this counted?** link for the current rules. Exports include raw time samples, counted intervals, and policy version 1.

## Connect Claude Code

Open **Connections**, select **Claude Code**, and copy the command for your project. Run it from the HackTrail directory, replacing the workspace placeholder with your project folder:

```sh
npm run connect:claude -- --project YOUR_PROJECT_ID --workspace "YOUR_PROJECT_FOLDER"
```

The installer adds local hooks in that project's `.claude/settings.local.json`, preserves other settings and hooks, and saves a backup in `.hacktrail/`. It also ignores the local files in Git. Restart Claude to load the hooks.

Hooks record prompts as events without storing their text, tool names and outcomes, and agent start/finish events. They do not store code, prompts, tool arguments, or outputs. The dashboard updates automatically.

Agent time is elapsed time between paired start and finish hooks, so it can include waiting. Interrupted or unmatched runs are excluded from the duration and flagged for review. Agent time is never added to editor time.

If the collector is offline, hook events are queued locally and retry on the next hook, up to 5,000 queued entries. To remove HackTrail's hooks while preserving other hooks:

```sh
npm run connect:claude -- --workspace "YOUR_PROJECT_FOLDER" --remove
```

## Explore and review

**Today** shows estimated editor time, this week's chart, work sessions, notes, and tool connections. **Activity** shows live and imported events with filters and evidence details. **Review** summarizes the last seven days and surfaces recorded failures and incomplete agent runs.

**Explore an example** adds clearly labeled synthetic activity. It does not invent working hours.

You can still import an individual Claude JSONL transcript up to 10 MB. Message excerpts are optional and off by default. Reimporting an unchanged or appended file skips duplicates. Preserve its name, existing lines, and excerpt setting when reimporting. Conflicting event IDs reject the whole import.

Imports add evidence, not retrospective working hours. **Export project record** includes the full project history, not just the week shown on screen.

## Local data

The SQLite database and local access token live in `.hacktrail/` under the directory where you start the collector. This directory is ignored by Git.

| Setting              | Default      | Purpose                       |
| -------------------- | ------------ | ----------------------------- |
| `HACKTRAIL_DATA_DIR` | `.hacktrail` | Choose another data directory |
| `HACKTRAIL_PORT`     | `47654`      | Choose another loopback port  |

The server binds to `127.0.0.1` and checks request hosts and origins. This is a single-user local app, not a public server or a security boundary against other programs on the same machine.

Stop HackTrail before copying its entire data directory for a backup. JSON exports are review records, not restorable workspace backups. Deleting a project removes its stored events and time samples. Connected editors disconnect when they learn that their project was deleted. Original transcripts are unchanged.

## Development

Run `npm run dev:server` and `npm run dev:web` in separate terminals, then open http://127.0.0.1:5173.

```sh
npm run check
npx playwright install chromium --only-shell
npm run test:e2e
```

`check` runs formatting, type checking, unit/integration tests, and a complete production build including the VSIX. Browser tests use a temporary database on port 47655 and temporary Claude workspaces. Use `npm run format` to format edits.

The stack is TypeScript, Fastify, SQLite, React, and Vite. See the [API contract](docs/api.md), [live tracking design](docs/live-tracking.md), and [UI research](docs/ui-design.md).

## Current limits

This release provides the local tracking and review workflow. It does not include accounts, public profiles, a hosted review service, Git linking, or every editor and AI harness. Local records are editable and do not verify authorship or approve bounty hours. The counting policy still needs validation against reference sessions.

CI is configured for macOS, Windows, and Linux. Platform support remains provisional until those checks pass. Performance on the Dell Inspiron 5775 still needs an actual device test. This is not a complete bounty submission.

Licensed under [GNU AGPLv3](LICENSE).
