import { createVSIX } from '@vscode/vsce';
import { resolve } from 'node:path';

await createVSIX({
  cwd: resolve('extensions/vscode'),
  packagePath: resolve('releases/hacktrail.vsix'),
  dependencies: false,
  githubBranch: 'main',
});
