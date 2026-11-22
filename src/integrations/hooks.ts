import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { LocalClient } from '../shared/local-client.js';
import type { Project } from '../shared/events.js';
import { randomUUID } from 'node:crypto';

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command?: string; timeout?: number; [key: string]: unknown }[];
  [key: string]: unknown;
}

export interface HookInstallation {
  workspace: string;
  projectId?: string;
  url: string;
  remove?: boolean;
  bundlePath: string;
  runtimePath?: string;
}

export async function installHooks(
  options: HookInstallation,
  adapter: {
    name: string;
    settings: string;
    runner: string;
    config: string;
    commandFile: string;
    events: string[];
  },
) {
  const workspace = resolve(options.workspace);
  const runtime = options.runtimePath ?? 'node';
  if (/["`$%\r\n]/.test(workspace + runtime))
    throw new Error(
      'This workspace path contains characters that cannot be safely used in a hook command.',
    );
  const localDirectory = join(workspace, '.hacktrail');
  const settingsPath = join(workspace, adapter.settings);
  let original = '';
  try {
    original = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const settings = original ? (JSON.parse(original) as Record<string, unknown>) : {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('Existing agent settings are not a valid object. Settings were not changed.');
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))
    throw new Error('Existing agent hooks are not a valid settings object.');
  const script = '"' + join(localDirectory, adapter.runner).replaceAll('\\', '/') + '"';
  const command =
    (runtime === 'node' ? 'node' : '"' + runtime.replaceAll('\\', '/') + '"') + ' ' + script;
  let previousCommand = 'node ' + script;
  try {
    previousCommand = await readFile(join(localDirectory, adapter.commandFile), 'utf8');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  let hadHooks = false;
  if (!options.remove) {
    if (!options.projectId)
      throw new Error('Provide --project with the project ID shown in HackTrail.');
    const projects = await new LocalClient(options.url).request<Project[]>('/projects');
    if (!projects.some((project) => project.id === options.projectId && !project.isExample))
      throw new Error('Create a real project in HackTrail before connecting the agent.');
  }
  for (const name of adapter.events) {
    const groups = hooks[name] ?? [];
    if (
      !Array.isArray(groups) ||
      groups.some(
        (group) =>
          !group ||
          !Array.isArray(group.hooks) ||
          group.hooks.some((hook) => !hook || typeof hook !== 'object'),
      )
    )
      throw new Error('An existing hook group is invalid. Settings were not changed.');
    if (
      groups.some((group) =>
        group.hooks.some((hook) =>
          [command, previousCommand, 'node ' + script].includes(hook.command ?? ''),
        ),
      )
    )
      hadHooks = true;
    hooks[name] = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter(
          (hook) => ![command, previousCommand, 'node ' + script].includes(hook.command ?? ''),
        ),
      }))
      .filter((group) => group.hooks.length);
    if (!options.remove) hooks[name]!.push({ hooks: [{ type: 'command', command, timeout: 3 }] });
    if (!hooks[name]!.length) delete hooks[name];
  }
  if (options.remove && !hadHooks) return settingsPath;
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  await mkdir(dirname(settingsPath), { recursive: true });
  const nextSettings = JSON.stringify({ ...settings, hooks }, null, 2) + '\n';
  if (original && original !== nextSettings)
    await writeFile(
      join(
        localDirectory,
        adapter.name.toLowerCase() +
          '-settings-backup-' +
          Date.now() +
          '-' +
          randomUUID() +
          '.json',
      ),
      original,
      { mode: 0o600, flag: 'wx' },
    );
  await writeFile(join(localDirectory, adapter.commandFile), command, { mode: 0o600 });
  if (!options.remove) {
    await copyFile(options.bundlePath, join(localDirectory, adapter.runner));
    await writeFile(
      join(localDirectory, adapter.config),
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
  for (const pattern of ['.hacktrail/', adapter.settings])
    if (!ignore.split(/\r?\n/).includes(pattern))
      ignore += (ignore.endsWith('\n') || !ignore ? '' : '\n') + pattern + '\n';
  await writeFile(join(workspace, '.gitignore'), ignore);
  if (original !== nextSettings) await writeFile(settingsPath, nextSettings, { mode: 0o600 });
  return settingsPath;
}
