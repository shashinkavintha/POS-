import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: path.join(__dirname, 'src'),
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
