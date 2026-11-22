import type { ActivityEvent } from './events.js';
import type { TimeSlice } from './tracking.js';

export const maxAgentRunMs = 12 * 60 * 60 * 1000;
interface Range {
  start: number;
  end: number;
}

function merge(ranges: Range[]) {
  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.end <= range.start) continue;
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function reviewActivity(
  events: ActivityEvent[],
  options: { from?: number; to?: number; slices?: TimeSlice[] } = {},
) {
  const from = options.from ?? -Infinity;
  const to = options.to ?? Infinity;
  const clip = (range: Range) => ({
    start: Math.max(from, range.start),
    end: Math.min(to, range.end),
  });
  const inRange = (time: number) => time >= from && time < to;
  const ordered = [...events].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      Number(b.kind === 'agent_started') - Number(a.kind === 'agent_started') ||
      a.id.localeCompare(b.id),
  );
  const visible = ordered.filter((event) => inRange(Date.parse(event.occurredAt)));
  const openRuns = new Map<string, number>();
  const ranges: Range[] = [];
  let incompleteRuns = 0;
  let closedRuns = 0;
  let interruptedRuns = 0;
  for (const event of ordered) {
    if (!event.metadata.sessionId) continue;
    const key = JSON.stringify([
      event.source,
      event.metadata.sessionId,
      event.metadata.turnId ?? '',
    ]);
    const time = Date.parse(event.occurredAt);
    if (event.kind === 'agent_started') {
      const previous = openRuns.get(key);
      if (previous !== undefined && inRange(previous)) incompleteRuns++;
      openRuns.set(key, time);
    }
    if (event.kind === 'agent_stopped') {
      const start = openRuns.get(key);
      if (start !== undefined && time >= start && time - start <= maxAgentRunMs) {
        if (time > from && start < to) {
          ranges.push(clip({ start, end: time }));
          closedRuns++;
          if (event.metadata.interrupted) interruptedRuns++;
        }
      } else if (inRange(time) || (start !== undefined && inRange(start))) incompleteRuns++;
      openRuns.delete(key);
    }
  }
  for (const start of openRuns.values()) if (inRange(start)) incompleteRuns++;
  const agent = merge(ranges);
  const editor = merge(
    (options.slices ?? []).map((slice) =>
      clip({ start: Date.parse(slice.startedAt), end: Date.parse(slice.endedAt) }),
    ),
  );
  let overlapMs = 0;
  let index = 0;
  for (const run of agent) {
    while (index < editor.length && editor[index]!.end <= run.start) index++;
    for (let i = index; i < editor.length && editor[i]!.start < run.end; i++) {
      overlapMs += Math.max(
        0,
        Math.min(run.end, editor[i]!.end) - Math.max(run.start, editor[i]!.start),
      );
    }
  }
  const agentMs = agent.reduce((sum, range) => sum + range.end - range.start, 0);
  const editorMs = editor.reduce((sum, range) => sum + range.end - range.start, 0);
  const lastHookBySource = Object.fromEntries(
    visible.filter((event) => event.metadata.hook).map((event) => [event.source, event.occurredAt]),
  );
  return {
    eventCount: visible.length,
    userMessages: visible.filter((event) => event.kind === 'user_prompt').length,
    toolCalls: visible.filter((event) => event.kind === 'tool_call').length,
    failedTools: visible.filter(
      (event) => event.kind === 'tool_result' && event.metadata.success === false,
    ).length,
    agentMs,
    editorMs,
    overlapMs,
    agentWithoutEditorMs: agentMs - overlapMs,
    editorWithoutAgentMs: editorMs - overlapMs,
    closedRuns,
    interruptedRuns,
    incompleteRuns,
    notes: visible
      .filter((event) => event.kind === 'work_note')
      .slice(-20)
      .reverse(),
    checkpoints: visible
      .filter((event) => event.kind === 'git_checkpoint')
      .slice(-20)
      .reverse(),
    sources: [...new Set(visible.map((event) => event.source))],
    lastHookBySource,
    lastHookAt: visible.filter((event) => event.metadata.hook).at(-1)?.occurredAt ?? null,
  };
}

export type ActivityReview = ReturnType<typeof reviewActivity>;
