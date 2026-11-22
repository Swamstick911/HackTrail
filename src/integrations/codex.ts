import { installHooks, type HookInstallation } from './hooks.js';

export function connectCodex(options: HookInstallation) {
  return installHooks(options, {
    name: 'Codex',
    settings: '.codex/hooks.json',
    runner: 'codex-hook.mjs',
    config: 'codex-connection.json',
    commandFile: 'codex-hook-command.txt',
    events: ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt'],
  });
}
