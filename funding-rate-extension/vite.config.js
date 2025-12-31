import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // base: './', // Commented out for Web App mode (defaults to '/')
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Setup a proxy to avoid CORS issues in development
    proxy: {
      '/api/binance': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/binance/, '')
      },
      '/api/coinswitch': {
        target: 'https://coinswitch.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/coinswitch/, '')
      }
    }
  }
})
