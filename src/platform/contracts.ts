import { z } from 'zod';
import { eventSchema } from '../shared/events.js';
import { timeSampleSchema } from '../shared/tracking.js';

export const credentialScopes = ['write:activity', 'read:stats'] as const;
export type CredentialScope = (typeof credentialScopes)[number];
export const webLink = z
  .union([
    z.literal(''),
    z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    }, 'Use an HTTPS link without credentials.'),
  ])
  .default('');
export const projectDetailsSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(''),
    repositoryUrl: webLink,
    demoUrl: webLink,
    visibility: z.enum(['private', 'public']).default('private'),
    archived: z.boolean().default(false),
  })
  .strict();
export type ProjectDetails = z.infer<typeof projectDetailsSchema>;
export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    bio: z.string().trim().max(300),
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid time zone.'),
    isPublic: z.boolean(),
    leaderboard: z.boolean(),
    dailyGoalMinutes: z.number().int().min(0).max(720),
  })
  .strict();
export type ProfileSettings = z.infer<typeof profileSchema>;
export interface Profile extends ProfileSettings {
  id: string;
  handle: string;
  createdAt: string;
}
export const syncSchema = z
  .object({
    project: z
      .object({ localId: z.string().min(3).max(128), name: z.string().trim().min(1).max(80) })
      .strict(),
    clientId: z.string().min(3).max(128),
    label: z.string().min(1).max(80),
    state: z.enum(['active', 'idle', 'paused']),
    samples: z.array(timeSampleSchema).max(500).default([]),
    events: z.array(eventSchema).max(500).default([]),
  })
  .strict();
export type SyncInput = z.infer<typeof syncSchema>;
export const rangeSchema = z
  .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .strict()
  .refine((range) => {
    const duration = Date.parse(range.to) - Date.parse(range.from);
    return duration > 0 && duration <= 32 * 86400_000;
  }, 'Choose a range of up to 32 days.');
