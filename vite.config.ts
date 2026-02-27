
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // @ts-ignore
  const cwd = process.cwd();
  const env = loadEnv(mode, cwd, '');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(cwd, 'src') },
        { find: '@shared', replacement: path.resolve(cwd, 'packages/shared/src') }
      ]
    },
    build: {
      target: ['es2020', 'safari14'],
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-motion': ['framer-motion'],
            'vendor-icons': ['lucide-react'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-md': ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
            'vendor-charts': ['recharts'],
            'vendor-query': [
              '@tanstack/react-query',
              '@tanstack/react-query-persist-client',
              '@tanstack/query-sync-storage-persister'
            ],
            'vendor-state': ['zustand'],
            'vendor-utils': ['clsx', 'tailwind-merge']
          }
        }
      }
    }
  };
});
