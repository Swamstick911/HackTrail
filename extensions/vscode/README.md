# HackTrail for VS Code

Track local editor activity, keep a project trail, and optionally sync to a HackTrail account.

## Get started

1. Install this VSIX with **Extensions: Install from VSIX** and reload VS Code.
2. Open a trusted project folder. Choose **Enable tracking** or **Editor only**.
3. Select Git, Claude Code, and Codex collection independently when prompted.
4. Start working. The extension starts a local collector and opens its dashboard.

Setup reuses Node.js 26 or downloads a pinned runtime from nodejs.org with a SHA-256 check. There is no separate terminal command or account requirement for local tracking. Codex hooks require your review through `/hooks`. Restart existing agent sessions after changing hooks.

## Connect an account

Run **HackTrail: Connect Account** and enter the platform address. Choose whether to sync Git and agent metadata alongside editor intervals, then approve the code in your browser. The credential is stored in VS Code SecretStorage. Projects start private.

The initial upload covers available activity from roughly the last seven days. Local notes, transcript excerpts, source code, prompts, tool arguments, and outputs do not sync automatically. Previously uploaded data is unchanged when disclosure preferences change; a saved batch awaiting acknowledgement keeps its original choices.

**HackTrail: Open Platform** opens the shared dashboard. **HackTrail: Disconnect Account** stops uploads and revokes device access if the server is reachable. If offline, revoke the device later in the platform's Connections page. Local tracking continues.

## Controls

- **HackTrail: Enable Tracking** revisits collection setup.
- **HackTrail: Pause or Resume Tracking** controls editor activity in this workspace.
- **HackTrail: Open Dashboard** opens the local record.
- **HackTrail: Disable Claude Tracking** and **Disable Codex Tracking** remove the selected hooks.
- **HackTrail: Disable Git Collection** stops new Git observations.

The status-bar tooltip shows local queue and account sync status. Local editor pause does not remove agent hooks. Platform account pause excludes editor intervals during that period, including late uploads, without stopping local collection.

## Counting and privacy

Keyboard and mouse selection signals begin an activity window. Blur ends it, two minutes without input reaches the idle cutoff, and sleep or scheduling gaps over 30 seconds are skipped. Overlapping windows count once. Offline samples retry, subject to seven-day retention and a 5,000-sample local queue limit.

This measures editor activity, not verified authorship, productive struggle, or program-approved hours. Agent runtime remains separate and requires paired lifecycle events. Git records commit IDs, branches, and aggregate changes, without code, paths, commit messages, authors, or remotes.

The local collector stores its database and token under VS Code global storage. Workspace state holds connection settings, queues, and sync progress. Project-local agent hooks and queues use the ignored `.hacktrail` directory. Deleting a cloud project does not erase the local record. Background sync does not recreate a deleted cloud project.

## Compatibility

Requires VS Code 1.100 or newer and a trusted file workspace. Runtime installation supports Windows, macOS, and Linux on x64 and ARM64. Remote SSH, WSL, containers, and individual alternative editors still need real-device validation. In a multi-folder workspace, choose which folder to track.

See the [repository](https://github.com/Swamstick911/HackTrail) and [platform guide](https://github.com/Swamstick911/HackTrail/blob/main/docs/platform.md) for setup, backups, API details, and current limits.

Licensed under GNU AGPLv3.
