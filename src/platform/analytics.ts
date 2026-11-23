import type { PlatformStore } from './store.js';
import type { ActivityEvent } from '../shared/events.js';
import type { TimeSlice } from '../shared/tracking.js';
import { reviewActivity, maxAgentRunMs } from '../shared/review.js';

const dayMs = 86_400_000;
export function calendarDate(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(time);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return value('year') + '-' + value('month') + '-' + value('day');
}

export function dayStart(date: string, timezone: string) {
  const center = Date.parse(date + 'T00:00:00Z');
  let low = center - 36 * 3600_000;
  let high = center + 36 * 3600_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (calendarDate(middle, timezone) < date) low = middle;
    else high = middle;
  }
  return high;
}

export function dateRange(days: number, timezone: string, now = Date.now()) {
  const today = calendarDate(now, timezone);
  const noon = Date.parse(today + 'T12:00:00Z');
  const dates = Array.from({ length: days }, (_, index) =>
    new Date(noon - (days - index - 1) * dayMs).toISOString().slice(0, 10),
  );
  return { from: dayStart(dates[0]!, timezone), to: now, dates };
}

function breakdown(slices: TimeSlice[], field: 'language' | 'editor' | 'signal') {
  const values = new Map<string, number>();
  for (const slice of slices) {
    const key = slice[field] || 'Unknown';
    values.set(
      key,
      (values.get(key) ?? 0) + Date.parse(slice.endedAt) - Date.parse(slice.startedAt),
    );
  }
  return [...values]
    .map(([name, totalMs]) => ({ name, totalMs }))
    .sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name));
}

export function dashboard(
  store: PlatformStore,
  owner: string,
  days = 7,
  options: { publicOnly?: boolean; timezone?: string; now?: number } = {},
) {
  const profile = store.profile(owner);
  const timezone = options.timezone ?? profile.timezone;
  const range = dateRange(days, timezone, options.now);
  const projects = store
    .projects(owner)
    .filter((project) => !options.publicOnly || project.visibility === 'public');
  const activity = store.user(owner);
  const slices: TimeSlice[] = [];
  const events: ActivityEvent[] = [];
  const rows = projects.map((project) => {
    const tracking = activity.tracking.report(project.id, range.from, range.to);
    slices.push(...tracking.slices);
    const records = store.database
      .prepare(
        'SELECT payload FROM events WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at, id',
      )
      .all(
        project.id,
        new Date(range.from - maxAgentRunMs).toISOString(),
        new Date(range.to + maxAgentRunMs).toISOString(),
      ) as { payload: string }[];
    const projectEvents = records.map((record) => JSON.parse(record.payload) as ActivityEvent);
    events.push(...projectEvents);
    return {
      ...project,
      totalMs: tracking.totalMs,
      agentMs: reviewActivity(projectEvents, { from: range.from, to: range.to }).agentMs,
      active: tracking.clients.some((client) => client.state === 'active'),
    };
  });
  const daily = new Map(range.dates.map((date) => [date, 0]));
  for (const slice of slices) {
    let cursor = Date.parse(slice.startedAt);
    const end = Date.parse(slice.endedAt);
    while (cursor < end) {
      const next = Math.min(end, (Math.floor(cursor / 60_000) + 1) * 60_000);
      const key = calendarDate(cursor, timezone);
      if (daily.has(key)) daily.set(key, daily.get(key)! + next - cursor);
      cursor = next;
    }
  }
  const review = reviewActivity(events, { from: range.from, to: range.to, slices });
  return {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
    timezone,
    totalMs: review.editorMs,
    agentMs: review.agentMs,
    overlapMs: review.overlapMs,
    editorWithoutAgentMs: review.editorWithoutAgentMs,
    agentWithoutEditorMs: review.agentWithoutEditorMs,
    incompleteRuns: review.incompleteRuns,
    interruptedRuns: review.interruptedRuns,
    daily: [...daily].map(([date, totalMs]) => ({ date, totalMs })),
    languages: breakdown(slices, 'language'),
    editors: breakdown(slices, 'editor'),
    signals: breakdown(slices, 'signal'),
    projects: rows.sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name)),
    paused: activity.tracking.paused(),
  };
}
export type Dashboard = ReturnType<typeof dashboard>;
