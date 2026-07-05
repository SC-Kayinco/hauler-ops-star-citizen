// Refresh the web app inside the portable Electron folder (release/HAULER-OPS).
// Fast rebuild path that avoids electron-builder (which hits an EPERM rename on
// this machine). Assumes the Electron runtime already lives in release/HAULER-OPS;
// only the app payload (dist + main.cjs) is replaced.
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const portable = path.join(root, 'release', 'HAULER-OPS')
const appDir = path.join(portable, 'resources', 'app')

if (!fs.existsSync(portable)) {
  console.error('release/HAULER-OPS not found. The Electron runtime must be assembled once first.')
  process.exit(1)
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ not built. Run "npm run build" first (package:app does this for you).')
  process.exit(1)
}

// Replace dist
fs.rmSync(path.join(appDir, 'dist'), { recursive: true, force: true })
fs.cpSync(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true })

// Replace electron runtime files (main + preload)
fs.rmSync(path.join(appDir, 'electron'), { recursive: true, force: true })
fs.cpSync(path.join(root, 'electron'), path.join(appDir, 'electron'), { recursive: true })

// App manifest
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify({ name: 'hauler-ops', version: '0.1.0', main: 'electron/main.cjs' }, null, 2),
)

console.log('✓ Refreshed portable app at:', path.join(portable, 'HAULER OPS.exe'))
