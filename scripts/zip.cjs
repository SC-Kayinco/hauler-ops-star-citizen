// Bundle the portable app folder (release/HAULER-OPS) into a versioned .zip.
// Filename: HAULER-OPS-v{version}.zip — never overwrites a previous release.
// Copies CHANGELOG.md into the zip so the user has release notes.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version ?? '0.0.0'

const src = path.join(root, 'release', 'HAULER-OPS')
const out = path.join(root, 'release', `HAULER-OPS-v${version}.zip`)
const changelog = path.join(root, 'CHANGELOG.md')
const changelogDest = path.join(src, 'CHANGELOG.md')

if (!fs.existsSync(src)) {
  console.error('release/HAULER-OPS not found. Run "npm run package:app" first.')
  process.exit(1)
}

// Copy changelog into the portable folder so it's included in the zip.
if (fs.existsSync(changelog)) {
  fs.copyFileSync(changelog, changelogDest)
}

// Don't overwrite an existing release zip — bump the version in package.json instead.
if (fs.existsSync(out)) {
  console.error(`✗ ${path.basename(out)} already exists. Bump the version in package.json first.`)
  process.exit(1)
}

// Use the built-in Windows Compress-Archive (no extra dependency).
try {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${src}\\*' -DestinationPath '${out}' -Force`],
    { stdio: 'inherit' },
  )
} catch {
  fs.rmSync(out, { force: true })
  console.error('\n✗ Zip failed — HAULER OPS.exe is probably still running (its runtime files are locked).')
  console.error('  Close the app window, then run "npm run dist:zip" again.')
  process.exit(1)
}

// Clean up the temp changelog copy from the portable folder.
if (fs.existsSync(changelogDest)) {
  fs.rmSync(changelogDest)
}

if (!fs.existsSync(out)) {
  console.error('✗ Zip was not created. Make sure HAULER OPS.exe is closed and try again.')
  process.exit(1)
}

const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1)
console.log(`✓ Portable zip ready: release/HAULER-OPS-v${version}.zip (${mb} MB)`)
console.log('  Copy to any Windows PC, extract, run "HAULER OPS.exe".')
