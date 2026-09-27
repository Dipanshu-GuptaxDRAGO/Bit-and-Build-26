import { defineNitroConfig } from 'nitro/config';
export default defineNitroConfig({
  modules: ['workflow/nitro'],
  vercel: { entryFormat: 'node' },
  routes: { '/api/**': { handler: './vercel/entry.ts', format: 'node' } },
  publicAssets: [{ dir: './frontend/dist', baseURL: '/' }],
});
