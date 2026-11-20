import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LocalClient } from '../shared/local-client.js';
import type { Project } from '../shared/events.js';

const hookNames = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'SessionEnd',
];
interface HookGroup {
  matcher?: string;
  hooks: { type: string; command?: string; timeout?: number; [key: string]: unknown }[];
  [key: string]: unknown;
}

export async function connectClaude(options: {
  workspace: string;
  projectId?: string;
  url: string;
  remove?: boolean;
  bundlePath: string;
}) {
  const workspace = resolve(options.workspace);
  if (/["`$\r\n]/.test(workspace))
    throw new Error(
      'This workspace path contains characters that cannot be safely used in a hook command.',
    );
  const localDirectory = join(workspace, '.hacktrail');
  const settingsPath = join(workspace, '.claude', 'settings.local.json');
  let original = '';
  try {
    original = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const settings = original ? (JSON.parse(original) as Record<string, unknown>) : {};
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))
    throw new Error('Existing Claude hooks are not a valid settings object.');
  const command = 'node "' + join(localDirectory, 'claude-hook.mjs').replaceAll('\\', '/') + '"';
  if (!options.remove) {
    if (!options.projectId)
      throw new Error('Provide --project with the project ID shown in HackTrail.');
    const projects = await new LocalClient(options.url).request<Project[]>('/projects');
    if (!projects.some((project) => project.id === options.projectId && !project.isExample))
      throw new Error('Create a real project in HackTrail before connecting Claude.');
  }
  for (const name of hookNames) {
    const groups = hooks[name] ?? [];
    if (!Array.isArray(groups) || groups.some((group) => !Array.isArray(group.hooks)))
      throw new Error('An existing hook group is invalid. Settings were not changed.');
    hooks[name] = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter((hook) => hook.command !== command) }))
      .filter((group) => group.hooks.length);
    if (!options.remove) hooks[name]!.push({ hooks: [{ type: 'command', command, timeout: 3 }] });
    if (!hooks[name]!.length) delete hooks[name];
  }
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  await mkdir(dirname(settingsPath), { recursive: true });
  if (original)
    await writeFile(
      join(localDirectory, 'claude-settings-backup-' + Date.now() + '.json'),
      original,
      { mode: 0o600, flag: 'wx' },
    );
  if (!options.remove) {
    await copyFile(options.bundlePath, join(localDirectory, 'claude-hook.mjs'));
    await writeFile(
      join(localDirectory, 'connection.json'),
      JSON.stringify({ projectId: options.projectId, url: new LocalClient(options.url).baseUrl }),
      { mode: 0o600 },
    );
  }
  let ignore = '';
  try {
    ignore = await readFile(join(workspace, '.gitignore'), 'utf8');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  for (const pattern of ['.hacktrail/', '.claude/settings.local.json'])
    if (!ignore.split(/\r?\n/).includes(pattern))
      ignore += (ignore.endsWith('\n') || !ignore ? '' : '\n') + pattern + '\n';
  await writeFile(join(workspace, '.gitignore'), ignore);
  await writeFile(settingsPath, JSON.stringify({ ...settings, hooks }, null, 2) + '\n', {
    mode: 0o600,
  });
  return settingsPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        project: { type: 'string' },
        workspace: { type: 'string', default: process.cwd() },
        url: { type: 'string', default: 'http://127.0.0.1:47654' },
        remove: { type: 'boolean', default: false },
      },
    });
    const path = await connectClaude({
      workspace: values.workspace!,
      projectId: values.project,
      url: values.url!,
      remove: values.remove,
      bundlePath: join(dirname(fileURLToPath(import.meta.url)), 'claude-hook.mjs'),
    });
    console.log(
      values.remove
        ? 'HackTrail hooks removed. Other hooks were preserved.'
        : 'Claude is connected. Restart the Claude session to load the new hooks.',
    );
    console.log('Settings: ' + path);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not update Claude settings.');
    process.exitCode = 1;
  }
}
