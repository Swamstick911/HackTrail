import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  outfile: 'extensions/vscode/dist/collector.mjs',
});
rmSync('extensions/vscode/dist/web', { recursive: true, force: true });
cpSync('dist/web', 'extensions/vscode/dist/web', { recursive: true });

await build({
  entryPoints: ['extensions/vscode/src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'extensions/vscode/dist/extension.cjs',
});
for (const adapter of ['claude', 'codex']) {
  await build({
    entryPoints: ['src/cli/' + adapter + '-hook.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node26',
    outfile: 'dist/cli/' + adapter + '-hook.mjs',
  });
  copyFileSync('LICENSE', 'extensions/vscode/LICENSE');
  copyFileSync(
    'dist/cli/' + adapter + '-hook.mjs',
    'extensions/vscode/dist/' + adapter + '-hook.mjs',
  );
}
mkdirSync('releases', { recursive: true });
