import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

// pnpm's hoisted linker may skip implicit node-gyp scripts for transitive dependencies.
// These addons run in the packaging tool's Node runtime, not Electron's runtime.
if (process.platform === 'darwin') {
  const nodeGyp = require.resolve('@electron/node-gyp/bin/node-gyp.js');
  for (const [name, binary] of [['macos-alias', 'volume.node'], ['fs-xattr', 'xattr.node']]) {
    const directory = path.dirname(require.resolve(`${name}/package.json`));
    if (!existsSync(path.join(directory, 'build/Release', binary))) {
      execFileSync(process.execPath, [nodeGyp, 'rebuild', `--directory=${directory}`, '--loglevel=error'], { stdio: 'inherit' });
    }
  }
}
