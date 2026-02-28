import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // @ts-ignore
  const cwd = process.cwd();
  const env = loadEnv(mode, cwd, '');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        manifest: {
          name: 'SportSync AI',
          short_name: 'SportSync',
          description: 'Real-time sports intelligence. Scores, odds, and AI-powered edge analysis.',
          start_url: '/?source=pwa',
          id: '/',
          scope: '/',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone'],
          orientation: 'portrait-primary',
          theme_color: '#09090b',
          background_color: '#09090b',
          categories: ['sports', 'entertainment', 'news'],
          icons: [
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ],
          screenshots: [
            {
              src: '/screenshots/feed.png',
              sizes: '1170x2532',
              type: 'image/png',
              form_factor: 'narrow',
              label: 'Live scores feed'
            }
          ],
          shortcuts: [
            {
              name: 'Live Games',
              short_name: 'Live',
              url: '/?view=live&source=pwa',
              icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }]
            },
            {
              name: 'Analytics',
              short_name: 'Titan',
              url: '/?view=titan&source=pwa',
              icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }]
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        }
      })
    ],
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
