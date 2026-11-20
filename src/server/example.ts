import type { ActivityEvent } from '../shared/events.js';
import type { ActivityStore } from './store.js';

export const exampleProjectId = 'hacktrail-example';

export function seedExample(store: ActivityStore) {
  let project = store.listProjects().find((item) => item.id === exampleProjectId);
  if (!project) project = store.createProject('Orbit Notes', exampleProjectId, true);
  const entries: {
    minute: number;
    kind: ActivityEvent['kind'];
    actor: ActivityEvent['actor'];
    metadata: ActivityEvent['metadata'];
  }[] = [
    {
      minute: 0,
      kind: 'user_prompt',
      actor: 'user',
      metadata: {
        excerpt:
          'Let us add offline search to the notes app. Start by checking how notes are stored.',
      },
    },
    {
      minute: 1,
      kind: 'tool_call',
      actor: 'agent',
      metadata: { toolName: 'Read', callId: 'example-read' },
    },
    {
      minute: 1,
      kind: 'tool_result',
      actor: 'tool',
      metadata: { callId: 'example-read', success: true },
    },
    {
      minute: 3,
      kind: 'agent_response',
      actor: 'agent',
      metadata: { excerpt: 'The notes are stored in IndexedDB. I will add a local search index.' },
    },
    {
      minute: 5,
      kind: 'tool_call',
      actor: 'agent',
      metadata: { toolName: 'Edit', callId: 'example-edit' },
    },
    {
      minute: 6,
      kind: 'tool_result',
      actor: 'tool',
      metadata: { callId: 'example-edit', success: true },
    },
    {
      minute: 8,
      kind: 'tool_call',
      actor: 'agent',
      metadata: { toolName: 'Bash', callId: 'example-test' },
    },
    {
      minute: 9,
      kind: 'tool_result',
      actor: 'tool',
      metadata: { callId: 'example-test', success: false },
    },
    {
      minute: 12,
      kind: 'user_prompt',
      actor: 'user',
      metadata: {
        excerpt: 'Search should also find words with accents. Can we add a test for that?',
      },
    },
    {
      minute: 13,
      kind: 'tool_call',
      actor: 'agent',
      metadata: { toolName: 'Edit', callId: 'example-fix' },
    },
    {
      minute: 14,
      kind: 'tool_result',
      actor: 'tool',
      metadata: { callId: 'example-fix', success: true },
    },
    {
      minute: 17,
      kind: 'tool_call',
      actor: 'agent',
      metadata: { toolName: 'Bash', callId: 'example-retest' },
    },
    {
      minute: 18,
      kind: 'tool_result',
      actor: 'tool',
      metadata: { callId: 'example-retest', success: true },
    },
    {
      minute: 20,
      kind: 'agent_response',
      actor: 'agent',
      metadata: {
        excerpt: 'Search now handles accented characters. The new regression test passes.',
      },
    },
    {
      minute: 35,
      kind: 'user_prompt',
      actor: 'user',
      metadata: {
        excerpt:
          'I tried it with my notes. Next, let us make keyboard navigation work in the results.',
      },
    },
  ];
  const events = entries.map((entry, index): ActivityEvent => ({
    schemaVersion: 1,
    id: 'example-event-' + String(index).padStart(3, '0'),
    projectId: exampleProjectId,
    occurredAt: new Date(Date.UTC(2026, 0, 15, 10, entry.minute)).toISOString(),
    source: 'claude-code',
    kind: entry.kind,
    actor: entry.actor,
    metadata: entry.metadata,
    evidence: { fileName: 'example-session.jsonl', line: index + 1, block: 0 },
  }));
  const result = store.ingest(events);
  return { project: store.getProject(project.id), ...result };
}
