import type { ActivityEvent } from '../src/shared/events.js';

export function activity(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    schemaVersion: 1, id: 'event-one', projectId: 'project-one',
    occurredAt: '2026-11-20T09:00:00.000Z', source: 'claude-code',
    actor: 'user', kind: 'user_prompt', metadata: {}, ...overrides,
  };
}

export function transcript() {
  return [
    { type: 'system', content: 'private system instructions' },
    {
      type: 'user', uuid: 'message-one', sessionId: 'session-one',
      timestamp: '2026-11-20T09:00:00Z',
      message: { role: 'user', content: 'Private project question' },
    },
    {
      type: 'assistant', uuid: 'message-two', sessionId: 'session-one',
      timestamp: '2026-11-20T09:01:00Z',
      message: { role: 'assistant', model: 'example-model', content: [
        { type: 'thinking', thinking: 'private model reasoning' },
        { type: 'text', text: 'Private response' },
        { type: 'tool_use', id: 'call-one', name: 'Bash', input: { command: 'private command' } },
      ] },
    },
    {
      type: 'user', uuid: 'message-three', sessionId: 'session-one',
      timestamp: '2026-11-20T09:02:00Z',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'call-one', is_error: false, content: 'private output' },
      ] },
    },
  ].map(entry => JSON.stringify(entry)).join('\n');
}
