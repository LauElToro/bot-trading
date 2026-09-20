/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';

// Bundle the authoritative signup terms as an offline fallback. The dashboard
// normally fetches them from the API, but a stale backend or a missing Vercel
// API URL must not disable legal acceptance. Reading the backend source here
// keeps the fallback byte-for-byte identical to the text whose hash is stored.
const termsSource = fs.readFileSync(
  path.resolve(__dirname, '../bot/src/server/v2-router.ts'),
  'utf8'
);
const termsVersion = termsSource.match(/const SIGNUP_TOS_VERSION = '([^']+)'/)?.[1];
const termsEn = termsSource.match(/const SIGNUP_TOS_TEXT_EN = `([\s\S]*?)`;/)?.[1];
const termsEs = termsSource.match(/const SIGNUP_TOS_TEXT_ES = `([\s\S]*?)`;/)?.[1];

if (!termsVersion || !termsEn || !termsEs) {
  throw new Error('Unable to extract the authoritative signup terms');
}

// Vite config for the Toro dashboard.
// - React 19 + Tailwind v4 plugin (no PostCSS config needed)
// - Path alias `@/*` → `src/*`
// - Dev proxy: /api/* and /ws → backend at localhost:3848 (override via env)
//   This avoids CORS issues during development without touching the backend.
export default defineConfig({
  // The public landing lives at / and the authenticated product starts at
  // /dashboard. Assets therefore use root-relative URLs in every deployment.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  define: {
    __TORO_SIGNUP_TOS__: JSON.stringify({
      version: termsVersion,
      text: termsEn,
      texts: { en: termsEn, es: termsEs },
    }),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy chart libs into their own vendor chunks so the
        // initial app shell stays small. The browser caches them
        // separately and the wizard/detail pages lazy-load them.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts-lwc': ['lightweight-charts'],
          'vendor-charts-recharts': ['recharts'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_TARGET ?? 'http://localhost:3848',
        changeOrigin: true,
      },
      '/ws': {
        target: (process.env.VITE_BACKEND_TARGET ?? 'http://localhost:3848').replace(
          /^http/,
          'ws'
        ),
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    // jsdom gives us a DOM in node so @testing-library/react can render.
    // globals: true exposes describe/it/expect without per-file import,
    // matching the bot/notifier convention.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false, // tailwind compilation isn't worth it in tests
  },
});
