import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(async ({ command }) => {
  const plugins = [react()]
  if (command === 'serve' && process.env.VISUAL_TRUTH === '1') {
    const { visualTruthSourcePlugin } = await import('visual-truth/vite')
    plugins.unshift(visualTruthSourcePlugin())
  }
  return {
    base: '/fitness/',
    plugins,
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  }
})
