// Assemble dist/desktop: the bundled agent, its runtime dependencies list, the installers and README.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const out = new URL('../dist/desktop/', import.meta.url)
mkdirSync(out, { recursive: true })
copyFileSync(new URL('../dist/agent.mjs', import.meta.url), new URL('agent.mjs', out))
for (const f of ['README.md', 'install-macos.sh', 'uninstall-macos.sh', 'install-windows.ps1']) copyFileSync(new URL(f, import.meta.url), new URL(f, out))
const runtime = JSON.parse(readFileSync(new URL('../docker/package.json', import.meta.url), 'utf8'))
writeFileSync(new URL('package.json', out), JSON.stringify({ ...runtime, name: 'cf-dam-agent' }, null, 2) + '\n')
console.log('dist/desktop ready')
