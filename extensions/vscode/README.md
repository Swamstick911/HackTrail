# HackTrail for VS Code and Cursor

Track editor activity locally without collecting code, file names, or keystrokes.

Start the HackTrail collector, open a trusted workspace, then run **HackTrail: Connect This Workspace** from the command palette. Choose a project. The status bar shows whether the collector is connected and whether tracking is active, idle, or paused.

Keyboard and mouse selection signals start a short activity window. After two minutes without another signal, counting stops. Switching away from the editor stops counting immediately. Merely focusing a window or receiving an automated file edit does not start the clock. Samples are sent every 15 seconds, so dashboard totals update in small steps.

This produces an estimate of editor activity, not proof of human work. Reading without interaction and terminal-only work may be missed. Use project notes to explain work the editor cannot observe.

The collector must run in the same environment as the extension host. For SSH, WSL, or containers, run HackTrail there too. Offline samples stay in local workspace storage, up to 5,000 samples, and retry when the collector returns. Samples older than seven days expire. Pausing the collector excludes time during the pause, including delayed uploads.

Use **HackTrail: Pause or Resume Tracking** to control this workspace. Use the dashboard pause control to pause all connected editors. The extension makes requests only to the loopback collector you select.
