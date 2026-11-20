import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const version = '26.8.1';
const archives: Record<string, { file: string; checksum: string }> = {
  'darwin-arm64': {
    file: 'node-v26.8.1-darwin-arm64.tar.gz',
    checksum: '6e577fd0d9db776db82306629e441a9dace416702622aebdd171c9dfaa41f4d2',
  },
  'darwin-x64': {
    file: 'node-v26.8.1-darwin-x64.tar.gz',
    checksum: 'fe9c6dbf9c8e1b4443803d75e2a20366e420dae650c747dbb116b22975751baf',
  },
  'linux-arm64': {
    file: 'node-v26.8.1-linux-arm64.tar.gz',
    checksum: 'd5f973ce975e4bd03e6c2038260f7e9201615aa8e1ee293c72f8dcc2a6d9fddb',
  },
  'linux-x64': {
    file: 'node-v26.8.1-linux-x64.tar.gz',
    checksum: 'b2b76660fa4ded4e0b2a41ee3c0c651cd52ea8170ead91ebac1e147ac3d55643',
  },
  'win32-arm64': {
    file: 'node-v26.8.1-win-arm64.zip',
    checksum: '09d62005aa9dca8fcd9bdce8196f5aa783eee3818d5af74089eb7297103c02d4',
  },
  'win32-x64': {
    file: 'node-v26.8.1-win-x64.zip',
    checksum: '57693d8e93d1b04e7b7de46aca53ecd63e97564e73de36a68428d7ff08d83587',
  },
};

export function verifyDownload(data: Uint8Array, checksum: string) {
  if (createHash('sha256').update(data).digest('hex') !== checksum)
    throw new Error(
      'The runtime download failed its integrity check. Please try enabling tracking again.',
    );
}

export function runtimeEnvironment() {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_OPTIONS;
  return environment;
}

async function usableRuntime(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execute(
      path,
      [
        '-e',
        'if (process.versions.electron || Number(process.versions.node.split(".")[0]) !== 26) process.exit(1); const {DatabaseSync}=require("node:sqlite"); new DatabaseSync(":memory:").close(); process.stdout.write(process.execPath);',
      ],
      { timeout: 10_000, windowsHide: true, env: runtimeEnvironment() },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function ensureRuntime(storage: string, report: (message: string) => void) {
  const executable = process.platform === 'win32' ? 'node.exe' : 'node';
  const directory = join(
    storage,
    'runtime-' + version + '-' + process.platform + '-' + process.arch,
  );
  const cached = await usableRuntime(join(directory, executable));
  if (cached) return cached;
  const installed = await usableRuntime(executable);
  if (installed) return installed;
  const archive = archives[process.platform + '-' + process.arch];
  if (!archive)
    throw new Error('Automatic setup supports Windows, macOS, and Linux on x64 and ARM64.');
  report('Downloading the local runtime. This only happens once.');
  await mkdir(storage, { recursive: true });
  const staging = await mkdtemp(join(storage, 'runtime-download-'));
  try {
    const response = await fetch('https://nodejs.org/dist/v' + version + '/' + archive.file, {
      signal: AbortSignal.timeout(180_000),
    }).catch(() => {
      throw new Error(
        'Could not download the runtime from nodejs.org. Check your connection and enable tracking again.',
      );
    });
    if (!response.ok)
      throw new Error('Could not download the runtime. Check your connection and try again.');
    const data = new Uint8Array(await response.arrayBuffer());
    verifyDownload(data, archive.checksum);
    const archivePath = join(staging, archive.file);
    await writeFile(archivePath, data, { mode: 0o600 });
    const root = archive.file.replace(/\.(tar\.gz|zip)$/, '');
    const binary = process.platform === 'win32' ? 'node.exe' : 'bin/node';
    await execute(
      'tar',
      ['-xf', archivePath, '-C', staging, root + '/' + binary, root + '/LICENSE'],
      {
        timeout: 60_000,
        windowsHide: true,
      },
    );
    const ready = join(staging, 'ready');
    await mkdir(ready);
    await copyFile(join(staging, root, binary), join(ready, executable));
    await copyFile(join(staging, root, 'LICENSE'), join(ready, 'LICENSE'));
    if (process.platform !== 'win32') await chmod(join(ready, executable), 0o700);
    if (!(await usableRuntime(join(ready, executable))))
      throw new Error('The downloaded runtime cannot run on this operating system.');
    try {
      await rename(ready, directory);
    } catch (error) {
      if (!(await usableRuntime(join(directory, executable)))) throw error;
    }
    return (await usableRuntime(join(directory, executable)))!;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
