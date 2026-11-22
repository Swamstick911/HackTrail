import { z } from 'zod';

export const sources = ['claude-code', 'codex', 'vscode', 'git', 'manual'] as const;
export const actors = ['user', 'agent', 'tool', 'unknown'] as const;
export const eventKinds = [
  'user_prompt',
  'agent_response',
  'tool_call',
  'tool_result',
  'editor_edit',
  'editor_focus',
  'git_commit',
  'git_checkpoint',
  'work_note',
  'agent_started',
  'agent_stopped',
] as const;

const identifier = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const shortText = z.string().max(160);
const timestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export const gitContextSchema = z
  .object({
    repositoryId: z.string().regex(/^[a-f0-9]{64}$/),
    commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    branch: z.string().max(160).optional(),
  })
  .strict();
export type GitContext = z.infer<typeof gitContextSchema>;

export const eventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    projectId: identifier,
    occurredAt: timestamp,
    source: z.enum(sources),
    actor: z.enum(actors),
    kind: z.enum(eventKinds),
    metadata: z
      .object({
        toolName: shortText.optional(),
        callId: shortText.optional(),
        model: shortText.optional(),
        sessionId: shortText.optional(),
        turnId: shortText.optional(),
        hook: shortText.optional(),
        success: z.boolean().optional(),
        interrupted: z.boolean().optional(),
        git: gitContextSchema.optional(),
        filesChanged: z.number().int().nonnegative().optional(),
        linesAdded: z.number().int().nonnegative().optional(),
        linesDeleted: z.number().int().nonnegative().optional(),
        checkpointReason: z.enum(['connected', 'head-changed', 'history-changed']).optional(),
        excerpt: z.string().max(500).optional(),
      })
      .strict()
      .default({}),
    evidence: z
      .object({
        fileName: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^/\\\u0000-\u001f]+$/),
        line: z.number().int().positive(),
        block: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ActivityEvent = z.infer<typeof eventSchema>;
export type Actor = ActivityEvent['actor'];
export type Source = ActivityEvent['source'];
export type EventKind = ActivityEvent['kind'];

export interface Project {
  id: string;
  name: string;
  isExample: boolean;
  createdAt: string;
  eventCount: number;
  lastEventAt: string | null;
}

export interface TimelinePage {
  events: ActivityEvent[];
  total: number;
  nextCursor: string | null;
}

export interface ProjectSummary {
  total: number;
  userMessages: number;
  agentEvents: number;
  toolEvents: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  sources: { source: Source; count: number }[];
}

export const kindLabels: Record<EventKind, string> = {
  user_prompt: 'User message',
  agent_response: 'Agent response',
  tool_call: 'Tool started',
  tool_result: 'Tool result',
  editor_edit: 'Editor change',
  editor_focus: 'Editor focus',
  git_commit: 'Git commit',
  git_checkpoint: 'Git checkpoint',
  work_note: 'Work note',
  agent_started: 'Agent started',
  agent_stopped: 'Agent finished',
};
