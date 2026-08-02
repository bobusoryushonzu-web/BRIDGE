import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // 共有パッケージは TypeScript のソースを直接参照する(ビルド手順を1つ減らす)
      '@bridge/shared': fileURLToPath(
        new URL('../../packages/shared/src', import.meta.url),
      ),
    },
  },
  server: { host: true },
});
