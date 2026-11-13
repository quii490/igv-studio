import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ base: './', server: { port: 5199, strictPort: true }, build: { outDir: 'dist', rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } } } });
