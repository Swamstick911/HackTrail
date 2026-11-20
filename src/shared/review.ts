import type { ActivityEvent } from './events.js';

export function reviewActivity(events: ActivityEvent[]) {
  const openRuns = new Map<string, number>();
  const ranges: { start: number; end: number }[] = [];
  let incompleteRuns = 0;
  let closedRuns = 0;
  for (const event of [...events].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  )) {
    const session = event.metadata.sessionId;
    if (!session) continue;
    if (event.kind === 'agent_started') {
      if (openRuns.has(session)) incompleteRuns++;
      openRuns.set(session, Date.parse(event.occurredAt));
    }
    if (event.kind === 'agent_stopped') {
      const start = openRuns.get(session);
      if (start !== undefined) {
        const end = Date.parse(event.occurredAt);
        if (end >= start && end - start <= 12 * 60 * 60 * 1000) {
          ranges.push({ start, end });
          closedRuns++;
        } else incompleteRuns++;
        openRuns.delete(session);
      }
    }
  }
  let agentMs = 0;
  let previousEnd = 0;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    agentMs += Math.max(0, range.end - Math.max(previousEnd, range.start));
    previousEnd = Math.max(previousEnd, range.end);
  }
  return {
    eventCount: events.length,
    userMessages: events.filter((event) => event.kind === 'user_prompt').length,
    toolCalls: events.filter((event) => event.kind === 'tool_call').length,
    failedTools: events.filter(
      (event) => event.kind === 'tool_result' && event.metadata.success === false,
    ).length,
    agentMs,
    closedRuns,
    incompleteRuns: incompleteRuns + openRuns.size,
    notes: events
      .filter((event) => event.kind === 'work_note')
      .slice(-20)
      .reverse(),
    sources: [...new Set(events.map((event) => event.source))],
    lastHookAt: events.filter((event) => event.metadata.hook).at(-1)?.occurredAt ?? null,
  };
}

export type ActivityReview = ReturnType<typeof reviewActivity>;
