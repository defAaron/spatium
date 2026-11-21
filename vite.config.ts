import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: { '/api': process.env.SPATIUM_API_ORIGIN || 'http://127.0.0.1:8000' },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.spatium/**'] },
  },
});
