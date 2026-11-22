import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalClient } from '../shared/local-client.js';
import type { ActivityEvent } from '../shared/events.js';

export async function runHook(
  directory: string,
  configFile: string,
  queueName: string,
  normalize: (input: Record<string, unknown>, projectId: string) => ActivityEvent[],
) {
  await deliver().catch(() => undefined);
  async function deliver() {
    const config = JSON.parse(await readFile(join(directory, configFile), 'utf8')) as {
      projectId: string;
      url: string;
    };
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk);
      length += buffer.length;
      if (length > 16 * 1024 * 1024) return;
      chunks.push(buffer);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const events = normalize(input, config.projectId);
    if (!events.length) return;
    const queueDirectory = join(directory, queueName);
    await mkdir(queueDirectory, { recursive: true, mode: 0o700 });
    const pending = (await readdir(queueDirectory)).filter((name) => name.endsWith('.json')).sort();
    if (pending.length >= 5000) {
      process.stderr.write(
        'HackTrail queue is full. Start the collector to sync pending activity.\n',
      );
      return;
    }
    const entry = Date.now() + '-' + randomUUID() + '.json';
    await writeFile(join(queueDirectory, entry), JSON.stringify(events), {
      mode: 0o600,
      flag: 'wx',
    });
    const names = [...pending, entry].slice(0, 100);
    const queued: { name: string; events: ActivityEvent[] }[] = [];
    for (const name of names) {
      try {
        queued.push({
          name,
          events: JSON.parse(await readFile(join(queueDirectory, name), 'utf8')) as ActivityEvent[],
        });
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
          throw error;
      }
    }
    if (!queued.length) return;
    await new LocalClient(config.url, 700).request('/events', {
      events: queued.flatMap((item) => item.events),
    });
    for (const item of queued) await unlink(join(queueDirectory, item.name)).catch(() => undefined);
  }
}
