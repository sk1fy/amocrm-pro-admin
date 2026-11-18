import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

for (const purpose of ['core', 'managers', 'demo']) {
  test(`${purpose} emits its own module graph`, async () => {
    const result = await build({
      configFile,
      mode: purpose,
      logLevel: 'silent',
      build: { write: false },
    })
    const graph = result.output.find((entry) => entry.fileName === 'module-graph.json')
    assert.ok(graph, 'build must emit its actual module graph')
    const manifest = JSON.parse(graph.source)
    assert.equal(manifest.purpose, purpose)
    const entry =
      purpose === 'core'
        ? 'src/main.tsx'
        : `${purpose === 'managers' ? 'manager' : 'demo'}/main.tsx`
    assert.ok(manifest.modules.includes(entry), `graph must contain ${entry}`)
    assert.equal(
      manifest.modules.some((path) => path.startsWith('src/features/managers/')),
      purpose === 'demo',
    )
    assert.equal(manifest.modules.includes('src/app/router.tsx'), purpose === 'core')
    assert.equal(manifest.modules.includes('manager/ManagerApp.tsx'), purpose === 'managers')
  })
}

for (const purpose of ['core', 'managers']) {
  test(`${purpose} rejects a real demo fixture imported into the emitted graph`, async () => {
    await assert.rejects(
      build({
        configFile,
        mode: purpose,
        logLevel: 'silent',
        build: { write: false },
        plugins: [
          {
            name: 'inject-forbidden-demo-import',
            transform(code, id) {
              const entry = purpose === 'core' ? '/src/main.tsx' : '/manager/main.tsx'
              if (!id.endsWith(entry)) return
              return `import * as fixtures from '${root}src/features/managers/fixtures.ts';\nconsole.log(fixtures);\n${code}`
            },
          },
        ],
      }),
      /bundle contains forbidden module src\/features\/managers\//,
    )
  })
}

test('unknown purpose fails before building', async () => {
  await assert.rejects(
    build({ configFile, mode: 'production', logLevel: 'silent' }),
    /Unknown frontend purpose/,
  )
})
