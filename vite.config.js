
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',

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

      workbox: {
        navigateFallback: '/index.html',
        globPatterns: [
          '**/*.{js,css,html,svg,png,ico,woff2}',
        ],
        runtimeCaching: [],
      },
    }),
  ],
})
