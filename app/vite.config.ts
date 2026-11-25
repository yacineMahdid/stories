import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { checkOps, JsonEditRefused, parseDirection, patchText, formatJSON } from './server/json-style.ts'

// Everything the canvas creates is saved inside the repo so it can be versioned with git.
// STORY_DATA=path/to/folder opens another world instead (handy for keeping several).
const REPO_DIR = path.resolve(import.meta.dirname, '..')
const DATA_DIR = process.env.STORY_DATA ? path.resolve(process.env.STORY_DATA) : path.resolve(import.meta.dirname, '../data')
// How the app names the data folder in its messages: relative to the repo when inside it.
const DATA_LABEL = DATA_DIR.startsWith(REPO_DIR + path.sep) ? path.relative(REPO_DIR, DATA_DIR) : DATA_DIR
const ASSET_DIR = path.join(DATA_DIR, 'assets')
const WORLD_FILE = path.join(DATA_DIR, 'world.json')
const STAGING_FILE = path.join(DATA_DIR, 'staging.json')
const EXPORT_DIR = path.join(DATA_DIR, 'exports')
// The 3D engine lives at the repo root (src/, assets/) and imports three by its bare name.
const THREE_DIR = path.resolve(import.meta.dirname, 'node_modules/three')

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function safeName(name: string) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file'
}

function storyDataApi(): Plugin {
  return {
    name: 'story-data-api',
    configureServer(server) {
      fs.mkdirSync(ASSET_DIR, { recursive: true })
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://local')
        try {
          // A missing file is "nothing yet" (204), not an error: a fresh start logs nothing.
          if (url.pathname === '/api/world' && req.method === 'GET') {
            if (!fs.existsSync(WORLD_FILE)) { res.statusCode = 204; return res.end() }
            res.setHeader('content-type', 'application/json')
            return res.end(fs.readFileSync(WORLD_FILE))
          }
          if (url.pathname === '/api/world' && req.method === 'PUT') {
            const body = await readBody(req)
            JSON.parse(body.toString('utf8')) // refuse to write invalid JSON
            fs.writeFileSync(WORLD_FILE + '.tmp', body)
            fs.renameSync(WORLD_FILE + '.tmp', WORLD_FILE)
            return res.end('ok')
          }
          // The 3D direction (looks, places, staging): data/staging.json, see docs/scenes.md.
          // It is also written by hand, so the app sends small edits (set or delete one path)
          // that are applied to the file as it is on disk, never a stale copy of all of it.
          if (url.pathname === '/api/staging' && req.method === 'GET') {
            if (!fs.existsSync(STAGING_FILE)) { res.statusCode = 204; return res.end() }
            // A broken file is an error the app must show, not an empty direction.
            const doc = parseDirection(fs.readFileSync(STAGING_FILE, 'utf8'))
            res.setHeader('content-type', 'application/json')
            return res.end(JSON.stringify(doc))
          }
          if (url.pathname === '/api/staging' && req.method === 'PATCH') {
            const ops = checkOps(JSON.parse((await readBody(req)).toString('utf8'))?.ops)
            const before = fs.existsSync(STAGING_FILE) ? fs.readFileSync(STAGING_FILE, 'utf8') : formatJSON({ version: 1 }) + '\n'
            const { text, doc } = patchText(before, ops) // only the touched spans change
            fs.writeFileSync(STAGING_FILE + '.tmp', text)
            fs.renameSync(STAGING_FILE + '.tmp', STAGING_FILE)
            res.setHeader('content-type', 'application/json')
            return res.end(JSON.stringify(doc))
          }
          if (url.pathname === '/api/upload' && req.method === 'POST') {
            const name = `${crypto.randomUUID().slice(0, 8)}-${safeName(url.searchParams.get('name') ?? 'file')}`
            fs.writeFileSync(path.join(ASSET_DIR, name), await readBody(req))
            res.setHeader('content-type', 'application/json')
            return res.end(JSON.stringify({ src: `/data-assets/${name}` }))
          }
          if (url.pathname === '/api/export' && req.method === 'PUT') {
            fs.mkdirSync(EXPORT_DIR, { recursive: true })
            const name = safeName(url.searchParams.get('name') ?? 'story-bible.md')
            fs.writeFileSync(path.join(EXPORT_DIR, name), await readBody(req))
            return res.end(`${DATA_LABEL}/exports/${name}`)
          }
          if (url.pathname.startsWith('/data-assets/') && req.method === 'GET') {
            const file = path.join(ASSET_DIR, safeName(decodeURIComponent(url.pathname.slice(13))))
            if (!fs.existsSync(file)) { res.statusCode = 404; return res.end() }
            res.setHeader('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
            return res.end(fs.readFileSync(file))
          }
        } catch (e) {
          // A refused edit is the writer's to fix (400); anything else is a server error (500).
          res.statusCode = e instanceof JsonEditRefused ? 400 : 500
          return res.end(e instanceof Error ? e.message : String(e))
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), storyDataApi()],
  define: { __STORY_DATA__: JSON.stringify(DATA_LABEL) },
  resolve: {
    // One copy of three for the app and the engine files outside app/.
    alias: [
      { find: /^three$/, replacement: path.join(THREE_DIR, 'build/three.module.js') },
      { find: /^three\/addons\/(.*)$/, replacement: path.join(THREE_DIR, 'examples/jsm/$1') },
    ],
  },
  optimizeDeps: { exclude: ['three'] },
  // The engine (src/, assets/) sits outside app/, so let the dev server read the repo.
  server: { watch: { ignored: ['**/data/**', `${DATA_DIR}/**`] }, fs: { allow: [REPO_DIR] } },
  build: { target: 'esnext' }, // the prop catalog loads its families with top-level await
})
