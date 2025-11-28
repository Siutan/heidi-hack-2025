import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        overlay_window: resolve(__dirname, 'overlay.html'),
      },
    },
  },
});
