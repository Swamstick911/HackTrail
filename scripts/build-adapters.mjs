import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

await build({
  entryPoints: ['extensions/vscode/src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'extensions/vscode/dist/extension.cjs',
});
await build({
  entryPoints: ['src/cli/claude-hook.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  outfile: 'dist/cli/claude-hook.mjs',
});
copyFileSync('LICENSE', 'extensions/vscode/LICENSE');
mkdirSync('releases', { recursive: true });
