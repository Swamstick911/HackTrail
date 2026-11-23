import { z } from 'zod';
import { gitContextSchema, type GitContext } from './events.js';

export const trackingPolicy = {
  version: 1,
  idleAfterMs: 120_000,
  heartbeatMs: 15_000,
  maxSampleMs: 30_000,
  offlineRetentionMs: 7 * 24 * 60 * 60 * 1000,
} as const;

const identifier = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const timeSampleSchema = z
  .object({
    id: identifier,
    projectId: identifier,
    startedAt: instant,
    endedAt: instant,
    signal: z.enum(['keyboard', 'mouse', 'heartbeat']),
    language: z.string().max(64).optional(),
    editor: z.string().max(80).optional(),
    originSampleId: identifier.optional(),
    git: gitContextSchema.optional(),
  })
  .strict()
  .refine((sample) => {
    const duration = Date.parse(sample.endedAt) - Date.parse(sample.startedAt);
    return duration > 0 && duration <= trackingPolicy.maxSampleMs;
  }, 'Time samples must last between 1 ms and 30 seconds.');

export const heartbeatSchema = z
  .object({
    clientId: identifier,
    projectId: identifier,
    label: z.string().min(1).max(80),
    state: z.enum(['active', 'idle', 'paused']),
    samples: z.array(timeSampleSchema).max(500).default([]),
  })
  .strict();

export type TimeSample = z.infer<typeof timeSampleSchema>;
export type Heartbeat = z.infer<typeof heartbeatSchema>;
export interface TimeSlice {
  projectId: string;
  startedAt: string;
  endedAt: string;
  sampleId: string;
  git?: GitContext;
  language?: string;
  editor?: string;
  signal?: TimeSample['signal'];
}
export interface TrackingClient {
  id: string;
  projectId: string;
  label: string;
  state: 'active' | 'idle' | 'paused' | 'disconnected';
  lastSeenAt: string;
}
export interface TrackingReport {
  policy: typeof trackingPolicy;
  paused: boolean;
  totalMs: number;
  slices: TimeSlice[];
  clients: TrackingClient[];
}

export function durationLabel(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}
