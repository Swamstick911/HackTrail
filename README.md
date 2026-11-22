# HackTrail

Local time tracking and a project journal for people building with AI.

HackTrail estimates editor activity from VS Code, collects Claude Code and Codex events live, and keeps Git checkpoints and notes alongside the work. Editor time and agent time stay separate.

## Start with VS Code

1. Install `hacktrail.vsix` using **Extensions: Install from VSIX** in VS Code.
2. Open your project folder. Accept **Enable tracking** in the HackTrail prompt.
3. Start working. HackTrail opens the dashboard and handles the collector, project, Git observations, and agent hook installation automatically.

Choose **Editor only** in the prompt to skip Claude, Codex, and Git collection. Dismissing it leaves tracking off. You can return with **HackTrail: Enable Tracking** from the command palette. Restart an existing Claude session once after setup so it loads the hooks. In Codex, open `/hooks` to review and trust the new hooks before collection starts. Existing HackTrail installations must accept the new setup before Git or Codex collection is enabled.

No terminal command, account connection, API key, or separately installed Node.js is needed for extension users. Setup reuses Node.js 26 if available; otherwise it downloads a pinned runtime from nodejs.org and checks its SHA-256 digest before running it. Subsequent starts work offline.

The extension starts the collector when needed and restarts it after a disconnect. A collector started by the extension exits after ten minutes without requests. Existing projects and offline samples survive restarts.

The package is generated at `releases/hacktrail.vsix` by the build below. It is not published to the VS Code Marketplace yet. If you already created a project in the dashboard, use **Connections > Enable in VS Code** to link your open folder to it.

The extension requires VS Code 1.100 or newer and a trusted local folder. Automatic runtime setup supports Windows, macOS, and Linux on x64 and ARM64. In a multi-folder workspace, choose the folder to track; activity in other roots is excluded. Remote SSH, WSL, containers, and virtual workspaces still need separate validation.

## Build from source

For development, install Node.js 26 and Git. These commands also work in Windows PowerShell:

```sh
git clone https://github.com/Swamstick911/HackTrail.git
cd HackTrail
npm ci
npm run build
npm start
```

Open http://127.0.0.1:47654. This manual server runs until you press Ctrl+C. The extension reuses it when it is available. Stop older HackTrail servers before enabling tracking with an updated extension.

The build creates the dashboard, collector, Claude and Codex adapters, and installable VS Code extension. No native database compilation or cloud API key is needed.

## How time works

- Keyboard and mouse selection signals in the connected workspace start an activity window.
- Switching away stops counting. Two minutes without another input signal ends the window.
- Samples upload every 15 seconds. Sleep or scheduling gaps longer than 30 seconds are skipped.
- Overlapping windows count once, including across projects. The first accepted sample gets the overlapping time.
- Dashboard pause excludes the paused interval, including samples uploaded later.
- Offline samples retry automatically. The local queue holds up to 5,000 samples; samples older than seven days expire.

This is an estimate of editor activity, not verified human working time. Focus alone, file changes made by an agent, and agent runtime do not earn editor time. Reading without interaction, terminal work, planning, and testing elsewhere can be missed. Add a project note to keep that context.

Use the dashboard's **How is this counted?** link for the current rules. Exports include raw time samples, counted intervals, and policy version 1.

## Claude Code and Codex

Choosing **Enable tracking** in VS Code installs project-local hooks for both agents. Codex requires a supported version with lifecycle hooks and approval through `/hooks`; see the [Codex hook documentation](https://learn.chatgpt.com/docs/hooks). The installer keeps existing settings and other hooks, saves a backup when settings change, and ignores local tracking files in Git. Repeating setup does not duplicate hooks or projects.

Hooks record prompts as events without storing their text, tool names and outcomes, and agent start/finish events. They do not store code, prompts, tool arguments, or outputs. The dashboard updates automatically.

Agent time is elapsed time between paired start and finish hooks, so it can include waiting. Interrupted runs count up to the recorded interrupt. Missing boundaries and runs longer than 12 hours are excluded. Overlapping runs count once, and runs crossing the report boundary are clipped. Agent time is never added to editor time. Review shows the overlap and agent runtime without editor signals. Neither the overlap nor its absence proves attention, learning, or unassisted work.

If the collector is offline, hook events are queued locally and retry on the next hook, up to 5,000 queued entries. **HackTrail: Disable Claude Tracking** and **HackTrail: Disable Codex Tracking** remove only the chosen adapter's hooks. Restart existing agent sessions afterward. Editor pause controls affect editor time; use these separate commands to stop agent collection.

For setups without VS Code, the optional CLI remains available:

```sh
npm run connect:claude -- --project YOUR_PROJECT_ID --workspace "YOUR_PROJECT_FOLDER"
npm run connect:claude -- --workspace "YOUR_PROJECT_FOLDER" --remove
npm run connect:codex -- --project YOUR_PROJECT_ID --workspace "YOUR_PROJECT_FOLDER"
npm run connect:codex -- --workspace "YOUR_PROJECT_FOLDER" --remove
```

## Git context

With full tracking enabled, open the repository root in VS Code and have Git installed. HackTrail checks the local HEAD and branch every 30 seconds. The initial checkpoint records the current state without importing historical work. Later checkpoints capture changes in HEAD or branch, including checkouts and rewritten history.

Editor samples carry the last observed commit and branch. Checkpoints show aggregate file and text-line changes between observed commits when available; binary changes have no text-line count. Git observations do not add hours, prove authorship, or measure effort. Changes within a polling interval may be missed, and uncommitted edits are not captured.

No source code, file paths, commit messages, author details, or remotes are saved. Branch names and commit IDs may still reveal project information. Repository IDs hash the local Git directory and are not anonymous or portable across computers. **HackTrail: Disable Git Collection** stops new observations without deleting existing evidence.

## Explore and review

**Today** shows estimated editor time, this week's chart, work sessions, Git checkpoints, notes, and tool connections. **Activity** shows live and imported events with filters and evidence details. **Review** summarizes the last seven days and surfaces recorded failures and incomplete agent runs.

**Explore an example** adds clearly labeled synthetic activity. It does not invent working hours.

You can still import an individual Claude JSONL transcript up to 10 MB. Message excerpts are optional and off by default. Reimporting an unchanged or appended file skips duplicates. Preserve its name, existing lines, and excerpt setting when reimporting. Conflicting event IDs reject the whole import.

Imports add evidence, not retrospective working hours. **Export project record** includes the full project history, not just the week shown on screen.

## Local data

The extension stores its collector database, access token, log, and downloaded runtime in VS Code global storage for `swamstick911.hacktrail`. Workspace settings hold the local connection, Git observations, and offline editor queue. Agent hooks and their separate queues live in the project's ignored `.hacktrail/` directory.

When started manually with `npm start`, the collector stores its database and access token in `.hacktrail/` under the current directory. Reusing a running manual collector keeps that data location; the extension does not copy or move existing databases.

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

`check` runs formatting, type checking, unit/integration tests, and a complete production build including the VSIX. Browser tests use a temporary database on port 47655 and temporary agent workspaces. Use `npm run format` to format edits.

The stack is TypeScript, Fastify, SQLite, React, and Vite. See the [API contract](docs/api.md), [live tracking design](docs/live-tracking.md), and [UI research](docs/ui-design.md).

## Current limits

This release provides the local tracking and review workflow. It does not include accounts, public profiles, a hosted service, remote Git repository linking, or every editor and AI harness. Local records are editable and do not verify authorship or approve bounty hours. The counting policy still needs validation against reference sessions. The [bounty roadmap](docs/bounty-roadmap.md) keeps the remaining work tied to those requirements.

CI is configured for macOS, Windows, and Linux. Platform support remains provisional until those checks pass. Performance on the Dell Inspiron 5775 still needs an actual device test. This is not a complete bounty submission.

Licensed under [GNU AGPLv3](LICENSE).
