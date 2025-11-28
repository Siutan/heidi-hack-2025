import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        '@computer-use/nut-js',
        'electron-squirrel-startup',
      ],
    },
  },
});
