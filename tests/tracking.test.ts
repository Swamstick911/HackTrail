import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityStore } from '../src/server/store.js';
import { ActivityClock } from '../src/shared/activity-clock.js';
import type { Heartbeat, TimeSample } from '../src/shared/tracking.js';
import { hookEvents } from '../src/cli/hook-events.js';
import { reviewActivity } from '../src/shared/review.js';

describe('editor activity clock', () => {
  it('does not count focus alone and stops at the idle boundary', () => {
    const clock = new ActivityClock(0);
    clock.focus(0, true);
    expect(clock.tick(15_000)).toBeNull();
    clock.input(20_000, 'keyboard');
    expect(clock.tick(30_000)).toEqual({ start: 20_000, end: 30_000, signal: 'keyboard' });
    for (let now = 45_000; now <= 135_000; now += 15_000) clock.tick(now);
    expect(clock.tick(150_000)).toEqual({ start: 135_000, end: 140_000, signal: 'keyboard' });
    expect(clock.tick(165_000)).toBeNull();
  });
  it('does not bridge sleep or backwards clock changes', () => {
    const clock = new ActivityClock(0);
    clock.focus(0, true);
    clock.input(0, 'keyboard');
    expect(clock.tick(3_600_000)).toBeNull();
    expect(clock.tick(3_615_000)).toBeNull();
    clock.input(3_620_000, 'mouse');
    expect(clock.tick(3_630_000)?.start).toBe(3_620_000);
    expect(clock.tick(3_600_000)).toBeNull();
    expect(clock.tick(3_615_000)).toBeNull();
  });
  it('preserves the last active seconds when input resumes just after the idle cutoff', () => {
    const clock = new ActivityClock(0);
    clock.focus(0, true);
    clock.input(5000, 'keyboard');
    for (let now = 15_000; now <= 120_000; now += 15_000) clock.tick(now);
    expect(clock.input(127_000, 'mouse')).toEqual({
      start: 120_000,
      end: 125_000,
      signal: 'keyboard',
    });
    expect(clock.tick(135_000)).toEqual({
      start: 127_000,
      end: 135_000,
      signal: 'mouse',
    });
  });
  it('skips an unsampled sleep gap when the first wake event is new input', () => {
    const clock = new ActivityClock(0);
    clock.focus(0, true);
    clock.input(5000, 'keyboard');
    clock.tick(15_000);
    expect(clock.input(3_600_000, 'mouse')).toBeNull();
    expect(clock.tick(3_615_000)).toEqual({
      start: 3_600_000,
      end: 3_615_000,
      signal: 'mouse',
    });
  });
  it('closes the interval on blur and requires input after refocus', () => {
    const clock = new ActivityClock(0);
    clock.focus(0, true);
    clock.input(1000, 'mouse');
    expect(clock.focus(5000, false)).toEqual({ start: 1000, end: 5000, signal: 'mouse' });
    clock.input(7000, 'keyboard');
    clock.focus(10_000, true);
    expect(clock.tick(20_000)).toBeNull();
  });
});

describe('time storage', () => {
  let store: ActivityStore;
  const now = Date.parse('2026-11-20T10:00:00Z');
  const sample = (
    id: string,
    start: number,
    end: number,
    projectId = 'project-one',
  ): TimeSample => ({
    id,
    projectId,
    startedAt: new Date(now + start).toISOString(),
    endedAt: new Date(now + end).toISOString(),
    signal: 'keyboard',
  });
  const heartbeat = (
    samples: TimeSample[],
    projectId = 'project-one',
    clientId = 'editor-one',
  ): Heartbeat => ({ clientId, projectId, label: 'VS Code', state: 'active', samples });
  beforeEach(() => {
    store = new ActivityStore(':memory:');
    store.createProject('First', 'project-one');
    store.createProject('Second', 'project-two');
  });
  afterEach(() => store.close());
  it('persists samples and skips retries without counting twice', () => {
    const input = heartbeat([sample('sample-one', -15_000, 0)]);
    expect(store.tracking.heartbeat(input, now)).toMatchObject({ creditedMs: 15_000, inserted: 1 });
    expect(store.tracking.heartbeat(input, now)).toMatchObject({ creditedMs: 0, duplicates: 1 });
    expect(store.tracking.export('project-one').samples).toHaveLength(1);
  });
  it('does not count overlapping windows or projects twice', () => {
    store.tracking.heartbeat(heartbeat([sample('sample-one', -30_000, -10_000)]), now);
    expect(
      store.tracking.heartbeat(
        heartbeat([sample('sample-two', -20_000, 0)], 'project-one', 'editor-two'),
        now,
      ).creditedMs,
    ).toBe(10_000);
    expect(
      store.tracking.heartbeat(
        heartbeat([sample('sample-three', -15_000, 0, 'project-two')], 'project-two'),
        now,
      ).creditedMs,
    ).toBe(0);
  });
  it('excludes paused time even when an offline sample arrives after resume', () => {
    store.tracking.pause(true, now - 20_000);
    store.tracking.pause(false, now - 10_000);
    expect(
      store.tracking.heartbeat(heartbeat([sample('sample-one', -30_000, 0)]), now).creditedMs,
    ).toBe(20_000);
    expect(store.tracking.report('project-one', now - 15_000, now, now).totalMs).toBe(10_000);
  });
  it('rejects excessive, stale, future, and cross-project samples atomically', () => {
    for (const invalid of [
      sample('bad-length', -31_000, 0),
      sample('bad-future', 10_000, 20_000),
      sample('bad-stale', -8 * 86_400_000, -8 * 86_400_000 + 1000),
      sample('bad-project', -1000, 0, 'project-two'),
    ]) {
      expect(() =>
        store.tracking.heartbeat(heartbeat([sample('valid-sample', -1000, 0), invalid]), now),
      ).toThrow();
      expect(store.tracking.export('project-one').samples).toHaveLength(0);
    }
  });
  it('rejects conflicting retries and marks stale clients disconnected', () => {
    store.tracking.heartbeat(heartbeat([sample('sample-one', -15_000, 0)]), now);
    expect(() =>
      store.tracking.heartbeat(
        heartbeat([sample('sample-two', -30_000, -20_000), sample('sample-one', -10_000, 0)]),
        now,
      ),
    ).toThrow('different contents');
    expect(
      store.tracking.report('project-one', now - 60_000, now, now + 46_000).clients[0]?.state,
    ).toBe('disconnected');
    expect(store.tracking.export('project-one').samples).toHaveLength(1);
  });
  it('deletes time and connection records with their project', () => {
    store.tracking.heartbeat(heartbeat([sample('sample-one', -15_000, 0)]), now);
    store.deleteProject('project-one');
    expect(store.tracking.export('project-one').samples).toHaveLength(0);
    expect(
      store.tracking.heartbeat(
        heartbeat([sample('sample-two', -15_000, 0, 'project-two')], 'project-two'),
        now,
      ).creditedMs,
    ).toBe(15_000);
  });
});

describe('Claude live activity', () => {
  it('retains hook metadata without prompts, paths, arguments or outputs', () => {
    const events = hookEvents(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'session-one',
        tool_name: 'Bash',
        tool_use_id: 'tool-one',
        tool_input: { command: 'private' },
        tool_response: 'private',
        prompt: 'private',
        cwd: '/private',
      },
      'project-one',
    );
    expect(events[0]).toMatchObject({
      actor: 'tool',
      kind: 'tool_result',
      metadata: { success: true, toolName: 'Bash' },
    });
    expect(JSON.stringify(events)).not.toContain('private');
  });
  it('does not treat session cleanup after a completed turn as a missing run', () => {
    const events = ['UserPromptSubmit', 'Stop', 'SessionEnd'].flatMap((hook, index) =>
      hookEvents(
        { session_id: 'session-one', hook_event_name: hook },
        'project-one',
        new Date(1000 + index * 1000),
      ),
    );
    expect(reviewActivity(events)).toMatchObject({ agentMs: 1000, incompleteRuns: 0 });
  });
  it('keeps agent duration separate and flags incomplete runs', () => {
    const input = { session_id: 'session-one' };
    const events = [
      ...hookEvents(
        { ...input, hook_event_name: 'UserPromptSubmit' },
        'project-one',
        new Date('2026-11-20T10:00:00Z'),
      ),
      ...hookEvents(
        { ...input, hook_event_name: 'Stop' },
        'project-one',
        new Date('2026-11-20T10:02:00Z'),
      ),
      ...hookEvents(
        { ...input, hook_event_name: 'UserPromptSubmit' },
        'project-one',
        new Date('2026-11-20T10:03:00Z'),
      ),
    ];
    expect(reviewActivity(events)).toMatchObject({
      agentMs: 120_000,
      closedRuns: 1,
      incompleteRuns: 1,
      userMessages: 2,
    });
  });
});
