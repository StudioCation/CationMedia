import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { target: 'chrome140' }, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
