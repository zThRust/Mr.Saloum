
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { seoPlugin, siteOrigin } from './scripts/seo.mjs'

export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      input: ['index.html', 'admin/index.html'].map((path) => fileURLToPath(new URL(path, import.meta.url))),
    },
  },
  plugins: [
    react(),
    seoPlugin(siteOrigin(loadEnv(mode, process.cwd(), 'VITE_SITE_URL').VITE_SITE_URL)),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: false,

      includeAssets: [
        'pwa-192.png',
        'pwa-512.png',
      ],

      manifest: {
        name: 'Mr.Saloum Barbearia',
        short_name: 'Mr.Saloum',
        description:
          'Agendamento de horários e gerenciamento da barbearia Mr.Saloum',

        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',

        background_color: '#10100f',
        theme_color: '#10100f',

        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      injectManifest: {
        globPatterns: ['assets/**/*.{js,css,svg,png,jpg,webp,woff2}'],
      },
    }),
  ],
}))
