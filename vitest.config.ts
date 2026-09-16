import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Two projects rather than one shared environment. Server and shared tests are pure Node and
// must stay that way — handing them a DOM would hide a real bug where server code reaches for
// a browser global. Only the component tests under src/ get jsdom, React and the '@' alias.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          // src/tests/qa-automation.spec.ts is a Playwright spec (separate runner, see
          // playwright.config.ts) and is deliberately not matched by either project.
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        plugins: [react()],
        resolve: {
          // Matches vite.config.ts so component tests resolve the same '@/...' imports the app does.
          alias: { '@': path.resolve(dirname, './src') }
        },
        test: {
          name: 'components',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/tests/setup.ts']
        }
      }
    ]
  }
});
