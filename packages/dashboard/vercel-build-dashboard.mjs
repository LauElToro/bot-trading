import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dashboardDir, '../..');
const srcDist = path.join(dashboardDir, 'dist');
const destDist = path.join(repoRoot, 'dist');

const viteBin = [
  path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
  path.join(dashboardDir, 'node_modules', 'vite', 'bin', 'vite.js'),
].find(existsSync);

if (!viteBin) {
  console.error('[vercel-build] vite binary not found. Did install include devDependencies?');
  process.exit(1);
}

const env = {
  ...process.env,
  VITE_BASE_PATH: process.env.VITE_BASE_PATH || '/',
};

const build = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: dashboardDir,
  env,
  stdio: 'inherit',
});

if (build.error) {
  console.error('[vercel-build] failed to start vite:', build.error);
  process.exit(1);
}

if (build.status) {
  process.exit(build.status);
}

if (!existsSync(path.join(srcDist, 'index.html'))) {
  console.error('[vercel-build] missing packages/dashboard/dist/index.html after vite build');
  console.error('[vercel-build] dashboard dir:', readdirSync(dashboardDir).join(', '));
  process.exit(1);
}

// Vercel Project Settings look for ./dist relative to Root Directory.
// Cover both repo-root and packages/dashboard as Root Directory.
if (srcDist !== destDist) {
  rmSync(destDist, { recursive: true, force: true });
  mkdirSync(destDist, { recursive: true });
  cpSync(srcDist, destDist, { recursive: true });
  console.log(`[vercel-build] staged ${srcDist} → ${destDist}`);
}

if (!existsSync(path.join(srcDist, 'index.html'))) {
  console.error('[vercel-build] dashboard dist vanished after staging');
  process.exit(1);
}

console.log('[vercel-build] ready:', path.join(srcDist, 'index.html'));
