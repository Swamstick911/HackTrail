import { randomUUID } from 'node:crypto';
import type { ActivityEvent } from '../shared/events.js';

export function codexEvents(
  input: Record<string, unknown>,
  projectId: string,
  now = new Date(),
): ActivityEvent[] {
  if (typeof input.session_id !== 'string' || !input.session_id) return [];
  if (typeof input.hook_event_name !== 'string') return [];
  const hook = input.hook_event_name;
  const metadata: ActivityEvent['metadata'] = { sessionId: input.session_id.slice(0, 160), hook };
  for (const [field, key] of [
    ['turn_id', 'turnId'],
    ['model', 'model'],
    ['tool_name', 'toolName'],
    ['tool_use_id', 'callId'],
  ] as const) {
    if (typeof input[field] === 'string') metadata[key] = input[field].slice(0, 160);
  }
  const make = (kind: ActivityEvent['kind'], actor: ActivityEvent['actor']): ActivityEvent => ({
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    occurredAt: now.toISOString(),
    source: 'codex',
    kind,
    actor,
    metadata: { ...metadata },
  });
  if (hook === 'UserPromptSubmit')
    return [make('user_prompt', 'user'), make('agent_started', 'agent')];
  if (hook === 'PreToolUse') return [make('tool_call', 'agent')];
  if (hook === 'PostToolUse') {
    const response = input.tool_response;
    if (response && typeof response === 'object') {
      if ('exit_code' in response && Number.isInteger(response.exit_code))
        metadata.success = response.exit_code === 0;
      else if ('isError' in response && typeof response.isError === 'boolean')
        metadata.success = !response.isError;
    }
    return [make('tool_result', 'tool')];
  }
  if (hook === 'Stop' || hook === 'Interrupt') {
    if (hook === 'Interrupt') metadata.interrupted = true;
    return [make('agent_stopped', 'agent')];
  }
  return [];
}
