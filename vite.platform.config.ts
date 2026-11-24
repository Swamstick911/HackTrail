import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'platform',
  plugins: [react()],
  build: { outDir: '../dist/platform-web', emptyOutDir: true },
});
