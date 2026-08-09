import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE lets GitHub Pages serve the app from /<repo-name>/.
// The deploy workflow sets it automatically; local dev uses '/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  server: { port: 5173, open: true }
})
