import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          launchWorker: 'src/main/launchWorker.ts'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Один экземпляр three на всех (skinview3d + наш CharacterStage) — иначе меши из
    // «чужого» three ломают рендерер skinview3d.
    resolve: { dedupe: ['three'] },
    plugins: [react()]
  }
})
