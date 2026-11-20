import { randomUUID } from 'node:crypto';
import type { ActivityEvent } from '../shared/events.js';

export function hookEvents(
  input: Record<string, unknown>,
  projectId: string,
  now = new Date(),
): ActivityEvent[] {
  const hook = typeof input.hook_event_name === 'string' ? input.hook_event_name : '';
  const sessionId =
    typeof input.session_id === 'string' ? input.session_id.slice(0, 160) : undefined;
  if (!sessionId) return [];
  const metadata: ActivityEvent['metadata'] = { sessionId, hook };
  if (typeof input.tool_name === 'string') metadata.toolName = input.tool_name.slice(0, 160);
  if (typeof input.tool_use_id === 'string') metadata.callId = input.tool_use_id.slice(0, 160);
  const make = (kind: ActivityEvent['kind'], actor: ActivityEvent['actor']): ActivityEvent => ({
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    occurredAt: now.toISOString(),
    source: 'claude-code',
    kind,
    actor,
    metadata: { ...metadata },
  });
  if (hook === 'UserPromptSubmit')
    return [make('user_prompt', 'user'), make('agent_started', 'agent')];
  if (hook === 'PreToolUse') return [make('tool_call', 'agent')];
  if (hook === 'PostToolUse' || hook === 'PostToolUseFailure') {
    metadata.success = hook === 'PostToolUse';
    return [make('tool_result', 'tool')];
  }
  if (['Stop', 'StopFailure', 'SessionEnd'].includes(hook)) {
    if (hook === 'StopFailure') metadata.success = false;
    return [make('agent_stopped', 'agent')];
  }
  return [];
}
