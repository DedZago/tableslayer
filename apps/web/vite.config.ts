import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      sentrySvelteKit({
        org: 'siege-perilous',
        project: 'tableslayer',
        authToken: env.SENTRY_AUTH_TOKEN
      }),
      sveltekit()
    ],
    preview: {
      port: 4174
    },
    test: {
      include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.{test,spec}.{js,ts}']
    },
    server: {
      port: 5174,
      strictPort: false,
      warmup: {
        clientFiles: [
          './src/routes/**/+page.svelte',
          './src/routes/**/+layout.svelte',
          './src/lib/components/**/*.svelte'
        ],
        ssrFiles: ['./src/routes/**/+page.svelte', './src/routes/**/+layout.svelte', './src/routes/**/+server.ts']
      }
    },
    optimizeDeps: {
      include: ['yjs', 'y-partykit/provider', 'chroma-js', '@tabler/icons-svelte'],
      exclude: ['@node-rs/argon2', '@node-rs/bcrypt', 'fsevents']
    },
    build: {
      commonjsOptions: {
        include: [/@tableslayer\/ui/, /node_modules/]
      },
      rollupOptions: {
        external: ['fsevents']
      }
    }
  };
});
