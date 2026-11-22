import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gitContextSchema, type GitContext, type ActivityEvent } from '../shared/events.js';

const execute = promisify(execFile);

export async function observeGit(workspace: string, projectId: string, previous?: GitContext) {
  const git = async (...args: string[]) =>
    (
      await execute('git', ['-c', 'core.fsmonitor=false', '-C', workspace, ...args], {
        timeout: 2500,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      })
    ).stdout.trimEnd();
  try {
    const root = await realpath(await git('rev-parse', '--show-toplevel'));
    if (root !== (await realpath(workspace))) return null;
    const directory = await realpath(resolve(root, await git('rev-parse', '--git-common-dir')));
    const commit = await git('rev-parse', '--verify', 'HEAD');
    const branch = await git('symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => undefined);
    const context = gitContextSchema.parse({
      repositoryId: createHash('sha256')
        .update(process.platform === 'win32' ? directory.toLowerCase() : directory)
        .digest('hex'),
      commit,
      branch: branch?.slice(0, 160),
    });
    if (
      previous?.repositoryId === context.repositoryId &&
      previous.commit === commit &&
      previous.branch === context.branch
    )
      return { context };
    const metadata: ActivityEvent['metadata'] = { git: context, checkpointReason: 'connected' };
    if (previous?.repositoryId === context.repositoryId && previous.commit !== commit) {
      metadata.checkpointReason = await git(
        'merge-base',
        '--is-ancestor',
        previous.commit,
        commit,
      ).then(
        () => 'head-changed' as const,
        () => 'history-changed' as const,
      );
      const diff = await git(
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--numstat',
        '-z',
        previous.commit,
        commit,
        '--',
      ).catch(() => undefined);
      if (diff !== undefined) {
        const files = diff.split('\0').filter(Boolean);
        metadata.filesChanged = files.length;
        metadata.linesAdded = 0;
        metadata.linesDeleted = 0;
        for (const file of files) {
          const [added, deleted] = file.split('\t');
          metadata.linesAdded += Number(added) || 0;
          metadata.linesDeleted += Number(deleted) || 0;
        }
      }
    }
    const event: ActivityEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId,
      occurredAt: new Date().toISOString(),
      source: 'git',
      actor: 'unknown',
      kind: 'git_checkpoint',
      metadata,
    };
    return { context, event };
  } catch {
    return null;
  }
}
