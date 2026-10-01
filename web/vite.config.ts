import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  repository: { url: string };
};

function gitCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const repositoryUrl = rootPackage.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/, Docker serves it from /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __REPOSITORY_URL__: JSON.stringify(repositoryUrl),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
