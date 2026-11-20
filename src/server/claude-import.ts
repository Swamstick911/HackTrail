import { createHash } from 'node:crypto';
import { eventSchema, type ActivityEvent } from '../shared/events.js';
import { StoreError } from './store.js';

export const maxImportBytes = 10 * 1024 * 1024;
const maxImportEvents = 20_000;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function shortString(value: unknown) {
  return typeof value === 'string' ? value.slice(0, 160) : undefined;
}

export function importClaude(input: {
  projectId: string;
  fileName: string;
  text: string;
  includeExcerpts: boolean;
}) {
  if (Buffer.byteLength(input.text) > maxImportBytes)
    throw new StoreError('Choose a transcript smaller than 10 MB.', 413);
  if (!/^[^/\\\u0000-\u001f]{1,255}$/.test(input.fileName))
    throw new StoreError('Use a file name without a directory path.', 400);
  const events: ActivityEvent[] = [];
  let ignoredRecords = 0;
  let recognizedRecords = 0;
  const lines = input.text.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new StoreError(
        'Invalid JSON on line ' + (lineIndex + 1) + '. Nothing was imported.',
        422,
      );
    }
    const entry = record(value);
    const message = record(entry?.message);
    if (
      !entry ||
      !message ||
      entry.isMeta === true ||
      !['user', 'assistant'].includes(String(entry.type))
    ) {
      ignoredRecords++;
      continue;
    }
    if (typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) {
      throw new StoreError('Missing or invalid timestamp on line ' + (lineIndex + 1) + '.', 422);
    }
    const role = message.role;
    if (role !== 'user' && role !== 'assistant') {
      ignoredRecords++;
      continue;
    }
    recognizedRecords++;
    const blocks =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content
          : [];
    const sessionId = shortString(entry.sessionId) ?? input.fileName;
    const recordId = shortString(entry.uuid) ?? digest(line);
    const occurredAt = new Date(entry.timestamp).toISOString();

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = record(blocks[blockIndex]);
      if (!block) continue;
      let kind: ActivityEvent['kind'];
      let actor: ActivityEvent['actor'];
      const metadata: ActivityEvent['metadata'] = {};
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        kind = role === 'user' ? 'user_prompt' : 'agent_response';
        actor = role === 'user' ? 'user' : 'agent';
        if (input.includeExcerpts) metadata.excerpt = block.text.slice(0, 500);
      } else if (block.type === 'tool_use' && role === 'assistant') {
        kind = 'tool_call';
        actor = 'agent';
        metadata.toolName = shortString(block.name);
        metadata.callId = shortString(block.id);
      } else if (block.type === 'tool_result') {
        kind = 'tool_result';
        actor = 'tool';
        metadata.callId = shortString(block.tool_use_id);
        if (typeof block.is_error === 'boolean') metadata.success = !block.is_error;
      } else {
        continue;
      }
      if (role === 'assistant') metadata.model = shortString(message.model);
      events.push(
        eventSchema.parse({
          schemaVersion: 1,
          id: digest([input.projectId, sessionId, recordId, blockIndex].join(':')),
          projectId: input.projectId,
          occurredAt,
          source: 'claude-code',
          actor,
          kind,
          metadata,
          evidence: { fileName: input.fileName, line: lineIndex + 1, block: blockIndex },
        }),
      );
      if (events.length > maxImportEvents)
        throw new StoreError('This file exceeds the 20,000 event import limit.', 413);
    }
  }
  if (!events.length)
    throw new StoreError('No supported Claude Code activity was found in this file.', 422);
  return {
    events,
    ignoredRecords,
    recognizedRecords,
    recordCount: lines.filter((line) => line.trim()).length,
  };
}
