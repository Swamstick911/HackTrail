import { installHooks, type HookInstallation } from './hooks.js';

export function connectClaude(options: HookInstallation) {
  return installHooks(options, {
    name: 'Claude',
    settings: '.claude/settings.local.json',
    runner: 'claude-hook.mjs',
    config: 'connection.json',
    commandFile: 'hook-command.txt',
    events: [
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ],
  });
}
