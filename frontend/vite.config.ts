import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const builds = {
  core: { root: '.', outDir: 'dist', forbidden: ['demo/', 'src/features/managers/', 'manager/'] },
  managers: {
    root: 'manager',
    outDir: '../dist-managers',
    forbidden: [
      'demo/',
      'src/features/managers/',
      'src/app/router.tsx',
      'src/features/auth/LoginPage.tsx',
    ],
  },
  demo: {
    root: 'demo',
    outDir: '../dist-demo',
    forbidden: ['manager/', 'src/app/router.tsx', 'src/features/auth/LoginPage.tsx', 'src/api/'],
  },
}
type BuildPurpose = keyof typeof builds

function buildPurpose(mode: string): BuildPurpose {
  switch (mode) {
    case 'core':
    case 'managers':
    case 'demo':
      return mode
    default:
      throw new Error(`Unknown frontend purpose "${mode}". Use core, managers or demo.`)
  }
}

function bundleBoundary(purpose: BuildPurpose): Plugin {
  return {
    name: 'frontend-purpose-boundary',
    generateBundle(_options, bundle) {
      const modules = new Set<string>()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) {
          const path = relative(frontendRoot, id.split('?')[0]).replaceAll('\\', '/')
          if (path.startsWith('../') || path.startsWith('node_modules/')) continue
          modules.add(path)
          if (builds[purpose].forbidden.some((forbidden) => path.startsWith(forbidden))) {
            this.error(`${purpose} bundle contains forbidden module ${path}`)
          }
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'module-graph.json',
        source: JSON.stringify({ purpose, modules: [...modules].sort() }, null, 2),
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const purpose = buildPurpose(mode)
  const spec = builds[purpose]
  return {
    root: resolve(frontendRoot, spec.root),
    build: { outDir: spec.outDir, emptyOutDir: true },
    plugins: [react(), bundleBoundary(purpose)],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy:
        purpose === 'demo'
          ? undefined
          : {
              '/api': { target: 'http://127.0.0.1:8090', changeOrigin: false },
            },
    },
  }
})
