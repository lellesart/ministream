import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        push: resolve(__dirname, 'src/pages/push.html'),
        view: resolve(__dirname, 'src/pages/view.html')
      }
    }
  },
  server: {
    host: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  }
});
