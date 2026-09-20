// Compatibility shim for Vercel projects whose Build Command is still
// configured as `node packages/dashboard/vercel-build-dashboard.mjs`
// while Root Directory is already `packages/dashboard`.
//
// Prefer `npm run build` in Vercel Project Settings. Keeping this shim makes
// existing deployments work until that dashboard-level override is removed.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../vercel-build-dashboard.mjs'
);

const result = spawnSync(process.execPath, [script], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[vercel-build:compat] failed to launch canonical build:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
