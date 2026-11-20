import { describe, expect, it } from 'vitest';
import { importClaude } from '../src/server/claude-import.js';
import { ActivityStore } from '../src/server/store.js';
import { transcript } from './fixtures.js';

const input = () => ({
  projectId: 'project-one',
  fileName: 'session.jsonl',
  text: transcript(),
  includeExcerpts: false,
});

describe('explicit Claude import', () => {
  it('keeps tool results separate from user messages', () => {
    const result = importClaude(input());
    expect(result.events.map((event) => [event.actor, event.kind])).toEqual([
      ['user', 'user_prompt'],
      ['agent', 'agent_response'],
      ['agent', 'tool_call'],
      ['tool', 'tool_result'],
    ]);
    expect(result.events.at(-1)?.evidence).toEqual({
      fileName: 'session.jsonl',
      line: 4,
      block: 0,
    });
  });

  it('excludes message text, reasoning, commands, and tool output by default', () => {
    const result = JSON.stringify(importClaude(input()));
    expect(result.toLowerCase()).not.toContain('private');
  });

  it('includes bounded message excerpts only with explicit opt-in', () => {
    const result = importClaude({ ...input(), includeExcerpts: true });
    expect(result.events[0]?.metadata.excerpt).toBe('Private project question');
    expect(JSON.stringify(result)).not.toContain('private model reasoning');
    expect(JSON.stringify(result)).not.toContain('private command');
  });

  it('preserves event IDs when new records are appended', () => {
    const original = importClaude(input());
    const appended = importClaude({
      ...input(),
      text:
        transcript() +
        '\n' +
        JSON.stringify({
          type: 'user',
          uuid: 'new-message',
          sessionId: 'session-one',
          timestamp: '2026-11-20T09:03:00Z',
          message: { role: 'user', content: 'Next task' },
        }),
    });
    expect(appended.events.slice(0, 4)).toEqual(original.events);
    const store = new ActivityStore(':memory:');
    store.createProject('Project', 'project-one');
    store.ingest(original.events);
    expect(store.ingest(appended.events)).toEqual({ inserted: 1, duplicates: 4 });
    store.close();
  });

  it('rejects malformed and partial records with a line number', () => {
    expect(() => importClaude({ ...input(), text: transcript() + '\n{"unfinished":' })).toThrow(
      'line 5',
    );
  });

  it('rejects absolute paths and unsupported files', () => {
    expect(() => importClaude({ ...input(), fileName: '/Users/private/session.jsonl' })).toThrow(
      'file name',
    );
    expect(() => importClaude({ ...input(), text: '{"type":"system"}' })).toThrow('No supported');
  });
});
