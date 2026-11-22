import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexEvents } from '../src/cli/codex-events.js';
import { observeGit } from '../src/integrations/git.js';
import { reviewActivity } from '../src/shared/review.js';
import { ActivityStore } from '../src/server/store.js';
import type { ActivityEvent } from '../src/shared/events.js';

const at = (seconds: number) =>
  new Date(Date.parse('2026-11-21T00:00:00Z') + seconds * 1000).toISOString();
function boundary(
  source: ActivityEvent['source'],
  kind: ActivityEvent['kind'],
  seconds: number,
  turnId?: string,
): ActivityEvent {
  return {
    schemaVersion: 1,
    id: [source, kind, seconds, turnId].join('-'),
    projectId: 'project-one',
    source,
    kind,
    actor: 'agent',
    occurredAt: at(seconds),
    metadata: { sessionId: 'shared-session', turnId },
  };
}

it('counts simultaneous sources and turns once, with only observed editor overlap', () => {
  const review = reviewActivity(
    [
      boundary('claude-code', 'agent_started', 0),
      boundary('codex', 'agent_started', 10, 'turn-one'),
      boundary('codex', 'agent_started', 20, 'turn-two'),
      boundary('codex', 'agent_stopped', 30, 'turn-one'),
      boundary('claude-code', 'agent_stopped', 40),
      boundary('codex', 'agent_stopped', 60, 'turn-two'),
    ],
    {
      slices: [
        { projectId: 'project-one', sampleId: 'one', startedAt: at(0), endedAt: at(15) },
        { projectId: 'project-one', sampleId: 'two', startedAt: at(10), endedAt: at(30) },
        { projectId: 'project-one', sampleId: 'three', startedAt: at(70), endedAt: at(80) },
      ],
    },
  );
  expect(review).toMatchObject({
    closedRuns: 3,
    incompleteRuns: 0,
    agentMs: 60_000,
    editorMs: 40_000,
    overlapMs: 30_000,
    agentWithoutEditorMs: 30_000,
    editorWithoutAgentMs: 10_000,
  });
});

it('clips runs crossing a reporting boundary and preserves Git context on clipped samples', () => {
  const store = new ActivityStore(':memory:');
  try {
    store.createProject('Project', 'project-one');
    store.ingest([
      boundary('codex', 'agent_started', -20, 'turn-one'),
      boundary('codex', 'agent_stopped', 20, 'turn-one'),
    ]);
    const git = { repositoryId: 'a'.repeat(64), commit: 'b'.repeat(40), branch: 'main' };
    store.tracking.heartbeat(
      {
        clientId: 'editor-one',
        projectId: 'project-one',
        label: 'VS Code',
        state: 'active',
        samples: [
          {
            id: 'sample-one',
            projectId: 'project-one',
            startedAt: at(-10),
            endedAt: at(10),
            signal: 'keyboard',
            git,
          },
        ],
      },
      Date.parse(at(10)),
    );
    const report = store.tracking.report('project-one', Date.parse(at(0)), Date.parse(at(60)));
    expect(report.slices[0]).toMatchObject({ git, startedAt: at(0), endedAt: at(10) });
    expect(store.review('project-one', at(0), at(60), report.slices)).toMatchObject({
      agentMs: 20_000,
      overlapMs: 10_000,
      eventCount: 1,
      closedRuns: 1,
    });
  } finally {
    store.close();
  }
});

it('excludes missing boundaries and excessive runtimes while retaining interrupted intervals', () => {
  const interrupted = boundary('codex', 'agent_stopped', 20, 'interrupt');
  interrupted.metadata.interrupted = true;
  const review = reviewActivity([
    boundary('codex', 'agent_started', 0, 'interrupt'),
    interrupted,
    boundary('codex', 'agent_started', 30, 'missing'),
    boundary('codex', 'agent_stopped', 40, 'orphan'),
    boundary('codex', 'agent_started', 50, 'long'),
    boundary('codex', 'agent_stopped', 50 + 13 * 3600, 'long'),
  ]);
  expect(review).toMatchObject({
    agentMs: 20_000,
    interruptedRuns: 1,
    closedRuns: 1,
    incompleteRuns: 3,
  });
});

it('normalizes Codex hooks without collecting conversation text or guessing tool success', () => {
  const input = {
    session_id: 'session',
    turn_id: 'turn',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    prompt: 'PRIVATE',
    cwd: 'PRIVATE',
    tool_input: { command: 'PRIVATE' },
    tool_response: { exit_code: 1, output: 'PRIVATE' },
    last_assistant_message: 'PRIVATE',
  };
  expect(codexEvents(input, 'project-one')[0]).toMatchObject({
    source: 'codex',
    kind: 'tool_result',
    metadata: { turnId: 'turn', success: false },
  });
  expect(JSON.stringify(codexEvents(input, 'project-one'))).not.toContain('PRIVATE');
  expect(
    codexEvents({ ...input, tool_response: 'PRIVATE' }, 'project-one')[0]?.metadata.success,
  ).toBeUndefined();
  expect(
    codexEvents({ ...input, hook_event_name: 'Interrupt' }, 'project-one')[0]?.metadata.interrupted,
  ).toBe(true);
});

describe('Git observations from a real repository', () => {
  let directory: string | undefined;
  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  it('observes changes and branch switches without recording paths, messages or uncommitted code', async () => {
    directory = mkdtempSync(join(tmpdir(), 'hacktrail-git-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-C',
          directory!,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { encoding: 'utf8' },
      ).trim();
    git('init', '-b', 'main');
    writeFileSync(join(directory, 'PRIVATE.txt'), 'first\n');
    git('add', '.');
    git('commit', '-m', 'PRIVATE first message');
    const initial = await observeGit(directory, 'project-one');
    expect(initial?.event?.metadata.checkpointReason).toBe('connected');
    expect(initial?.event?.metadata.linesAdded).toBeUndefined();
    expect((await observeGit(directory, 'project-one', initial!.context))?.event).toBeUndefined();
    writeFileSync(join(directory, 'PRIVATE.txt'), 'first\nsecond\n');
    git('add', '.');
    git('commit', '-m', 'PRIVATE second message');
    const next = await observeGit(directory, 'project-one', initial!.context);
    expect(next?.event?.metadata).toMatchObject({
      checkpointReason: 'head-changed',
      filesChanged: 1,
      linesAdded: 1,
      linesDeleted: 0,
    });
    expect(JSON.stringify(next)).not.toContain('PRIVATE');
    expect(JSON.stringify(next)).not.toContain(directory);
    writeFileSync(join(directory, 'PRIVATE.txt'), 'uncommitted PRIVATE\n');
    expect((await observeGit(directory, 'project-one', next!.context))?.event).toBeUndefined();
    git('restore', 'PRIVATE.txt');
    git('checkout', '--detach', initial!.context.commit);
    const detached = await observeGit(directory, 'project-one', next!.context);
    expect(detached?.context.branch).toBeUndefined();
    expect(detached?.event?.metadata.checkpointReason).toBe('history-changed');
    mkdirSync(join(directory, 'nested'));
    expect(await observeGit(join(directory, 'nested'), 'project-one')).toBeNull();
  });
});
