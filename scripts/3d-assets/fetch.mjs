#!/usr/bin/env node
/**
 * P4 / S2 — fetch the dental-scope 3D models and VERIFY them.
 *
 *   node scripts/3d-assets/fetch.mjs
 *
 * Downloads the pinned upstream tarball, extracts ONLY the files listed in
 * 3d-assets.manifest.json, verifies every SHA-256 and writes them to
 * `.local-assets/3d/` (gitignored — model files are NEVER committed).
 *
 * Rules:
 *   * the commit is PINNED; there is no "latest".
 *   * a checksum mismatch is a hard failure — the engines refuse to run on a
 *     mismatched file, and a digest is never edited to make a check pass.
 *   * `neurovascular.glb` is NEVER fetched (separate CC BY-SA 4.0 terms).
 *   * nothing is written outside `.local-assets/3d/`.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = path.join(root, '3d-assets.manifest.json')
const outDir = path.join(root, '.local-assets/3d')

function fail(message) {
  console.error(`[3d-assets] ${message}`)
  process.exit(1)
}

if (!existsSync(manifestPath)) fail(`missing ${path.relative(root, manifestPath)}`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const commit = manifest.upstream?.commit
const tarball = `https://codeload.github.com/Yoosseph/dental-scope/tar.gz/${commit}`
const sourcePath = manifest.upstream?.sourcePath ?? 'public/models'

if (!/^[0-9a-f]{40}$/.test(commit ?? '')) fail('manifest.upstream.commit is not a 40-hex sha')

for (const f of manifest.files ?? []) {
  if ((manifest.neverLoad ?? []).includes(path.basename(f.path))) {
    fail(`manifest lists a forbidden asset: ${f.path}`)
  }
}

console.log(`[3d-assets] upstream commit : ${commit}`)
console.log(`[3d-assets] destination     : ${path.relative(root, outDir)}`)
console.log(`[3d-assets] licence         : ${manifest.meshLicence}`)
console.log(`[3d-assets] NEVER fetched   : ${(manifest.neverLoad ?? []).join(', ')}`)

const tmp = path.join(root, '.local-assets/.tmp-fetch')
await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })

const tarPath = path.join(tmp, 'models.tar.gz')
console.log(`[3d-assets] downloading ${tarball}`)
await run('curl', ['-sSL', '--fail', '-o', tarPath, tarball]).catch((e) =>
  fail(`download failed: ${e.message}\n  (no network here? run this on a machine with egress)`),
)

const size = (await readFile(tarPath)).length
console.log(`[3d-assets] downloaded ${(size / 1e6).toFixed(1)} MB`)
await run('tar', ['xzf', tarPath, '-C', tmp])

const extractedRoot = path.join(tmp, `dental-scope-${commit}`)
const base = path.join(extractedRoot, sourcePath)
if (!existsSync(base)) fail(`tarball does not contain ${sourcePath}`)

await mkdir(outDir, { recursive: true })
let ok = 0
for (const f of manifest.files) {
  const src = path.join(base, f.path)
  if (!existsSync(src)) fail(`missing from tarball: ${f.path}`)

  const buf = await readFile(src)
  const digest = createHash('sha256').update(buf).digest('hex')
  if (digest !== f.sha256) {
    fail(
      `CHECKSUM MISMATCH for ${f.path}\n` +
        `  expected ${f.sha256}\n` +
        `  actual   ${digest}\n` +
        `  A digest is never edited to make this pass — investigate the file.`,
    )
  }
  if (buf.length !== f.bytes) fail(`size mismatch for ${f.path}: ${buf.length} != ${f.bytes}`)

  const dest = path.join(outDir, f.path)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, buf)
  ok++
}

await rm(tmp, { recursive: true, force: true })
console.log(`[3d-assets] verified and installed ${ok} files`)
console.log(`[3d-assets] next: set ASSET_MODE=local in .env (D1 still required to SHIP these)`)
