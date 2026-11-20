# HackTrail for VS Code

Local editor time tracking and a project journal for work with AI.

Install the extension, open a trusted project folder, and choose **Enable tracking** in the setup prompt. HackTrail starts its local collector, creates or links your project, installs Claude hooks, and opens the dashboard. There is no account connection, API key, or terminal command to copy.

Choose **Editor only** to leave Claude tracking out. Dismissing the prompt keeps tracking off. Use **HackTrail: Enable Tracking** to return to setup. If a Claude session is already running, restart it once to load the hooks.

Setup uses an existing Node.js 26 runtime or downloads one from nodejs.org and verifies its SHA-256 digest. This download happens once and needs internet access. The collector and dashboard are bundled with the extension. Windows, macOS, and Linux x64 and ARM64 are supported by the installer; Windows and Linux device testing is still pending.

## What gets recorded

Keyboard and mouse selection signals start an editor activity window. Two minutes without another signal ends it. Switching away stops counting immediately. Focusing a window or receiving an automated file edit does not start the clock. Samples upload every 15 seconds. Code, file names, and keystrokes are excluded.

Claude hooks record tool names, outcomes, and agent start and stop times. Prompt text, code, tool arguments, and output are excluded. Agent runtime stays separate from estimated editor time.

These records estimate activity. They do not prove human work. Reading without interaction, planning, and terminal work can be missed. Use project notes to keep that context.

## Controls and storage

- **HackTrail: Pause or Resume Tracking** controls editor tracking in this workspace.
- **HackTrail: Disable Claude Tracking** removes HackTrail's hooks while preserving other hooks. Restart existing Claude sessions afterward.
- **HackTrail: Open Dashboard** opens your local project journal.
- Dashboard pause excludes editor time across all connected projects, including delayed uploads.

The collector starts automatically and exits after ten minutes without requests. Data and the runtime live in VS Code global storage for this extension. Offline editor samples stay in workspace storage, with a limit of 5,000 samples and seven days. Claude hooks and pending events stay in the project's ignored `.hacktrail/` directory.

An existing compatible collector is reused. Stop an older HackTrail server before updating. If setup fails, its message explains the next step; run **HackTrail: Enable Tracking** to retry. Runtime downloads require access to nodejs.org, and archive extraction uses the system `tar` command.

In a multi-folder workspace, choose one folder to track. Other roots are excluded from editor time. Remote and virtual workspaces have not been validated for automatic setup.
