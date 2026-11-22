import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connectCodex } from '../integrations/codex.js';
export { connectCodex } from '../integrations/codex.js';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        project: { type: 'string' },
        workspace: { type: 'string', default: process.cwd() },
        url: { type: 'string', default: 'http://127.0.0.1:47654' },
        remove: { type: 'boolean', default: false },
      },
    });
    const path = await connectCodex({
      workspace: values.workspace!,
      projectId: values.project,
      url: values.url!,
      remove: values.remove,
      bundlePath: join(dirname(fileURLToPath(import.meta.url)), 'codex-hook.mjs'),
    });
    console.log(
      values.remove
        ? 'HackTrail hooks removed. Other hooks were preserved.'
        : 'Codex hooks installed. Open /hooks in Codex to review and trust them.',
    );
    console.log('Settings: ' + path);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not update Codex settings.');
    process.exitCode = 1;
  }
}
