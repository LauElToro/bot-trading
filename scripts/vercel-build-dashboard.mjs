import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../packages/dashboard/vercel-build-dashboard.mjs'
);

const result = spawnSync(process.execPath, [script], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[vercel-build] failed to start dashboard build:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
