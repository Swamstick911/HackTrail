import { spawn } from 'node:child_process';
import { mkdir, open, stat, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { collectorUrl } from '../../../src/shared/local-client.js';
import { ensureRuntime, runtimeEnvironment } from './runtime.js';

export const defaultCollectorUrl = 'http://127.0.0.1:47654';

async function running(url: string) {
  let response: Response;
  try {
    response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) });
  } catch {
    return false;
  }
  const health = (await response.json().catch(() => null)) as {
    service?: string;
    setupVersion?: number;
  } | null;
  if (!response.ok || health?.service !== 'hacktrail' || health.setupVersion !== 1)
    throw new Error(
      'Another app or an older HackTrail is using this address. Stop it, then enable tracking again.',
    );
  return true;
}

export class CollectorManager {
  private starting?: Promise<void>;

  constructor(
    private extensionPath: string,
    private storagePath: string,
  ) {}

  runtime(report: (message: string) => void) {
    return ensureRuntime(this.storagePath, report);
  }

  async ensure(url = defaultCollectorUrl, report: (message: string) => void = () => {}) {
    url = collectorUrl(url);
    if (this.starting) await this.starting;
    this.starting = (async () => {
      if (!(await running(url))) await this.start(url, report);
    })();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async start(url: string, report: (message: string) => void) {
    const runtime = await this.runtime(report);
    const dataDirectory = join(this.storagePath, 'collector');
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const logPath = join(dataDirectory, 'collector.log');
    const logSize = await stat(logPath).catch(() => null);
    if (logSize && logSize.size > 1024 * 1024) await truncate(logPath, 0);
    const log = await open(logPath, 'a', 0o600);
    report('Starting HackTrail on this computer.');
    let startError: Error | undefined;
    try {
      const child = spawn(runtime, [join(this.extensionPath, 'dist', 'collector.mjs')], {
        cwd: dataDirectory,
        env: {
          ...runtimeEnvironment(),
          HACKTRAIL_DATA_DIR: dataDirectory,
          HACKTRAIL_PORT: new URL(url).port || '80',
          HACKTRAIL_WEB_ROOT: join(this.extensionPath, 'dist', 'web'),
          HACKTRAIL_IDLE_TIMEOUT_MS: '600000',
        },
        stdio: ['ignore', log.fd, log.fd],
        detached: true,
        windowsHide: true,
      });
      child.on('error', (error) => {
        startError = error;
      });
      child.unref();
    } finally {
      await log.close();
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      if (startError) throw startError;
      if (await running(url)) return;
      await delay(250);
    }
    throw new Error('HackTrail could not start. Details are in ' + logPath);
  }
}
