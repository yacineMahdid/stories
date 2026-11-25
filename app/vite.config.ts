import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'

// Everything the canvas creates is saved inside the repo so it can be versioned with git.
const REPO_DIR = path.resolve(import.meta.dirname, '..')
const DATA_DIR = path.resolve(import.meta.dirname, '../data')
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

type StagingOp = { op: 'set'; path: string[]; value: unknown } | { op: 'delete'; path: string[] }

/** Set or delete one value deep in a JSON document (creating objects along the way). */
function applyOp(doc: any, op: StagingOp) {
  const bad = (k: unknown) => typeof k !== 'string' || k === '__proto__' || k === 'constructor' || k === 'prototype'
  if (!Array.isArray(op.path) || !op.path.length || op.path.some(bad)) throw new Error(`bad staging path ${JSON.stringify(op.path)}`)
  let node = doc
  for (const key of op.path.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) {
      if (op.op === 'delete') return
      node[key] = {}
    }
    node = node[key]
  }
  const last = op.path[op.path.length - 1]
  if (op.op === 'set') node[last] = op.value
  else delete node[last]
}

/**
 * JSON in the hand-written style of the direction files (see samples/brindlewick/staging.json),
 * so a save from the app changes only the lines it touches:
 * - lists of things (props, cast, shots, terrain) get one item per line, each item on one line
 * - short objects stay on one line; an object holding such a list is broken out
 * - lists of numbers or names (points, positions) always stay on one line
 * - a blank line separates the big sections and the place and page entries
 */
function inlineJSON(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inlineJSON).join(', ')}]`
  if (v && typeof v === 'object') {
    const e = Object.entries(v).filter(([, x]) => x !== undefined)
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inlineJSON(x)}`).join(', ')} }` : '{}'
  }
  return JSON.stringify(v) ?? 'null'
}
const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
const hasList = (v: unknown): boolean =>
  Array.isArray(v) ? v.some((x) => isObj(x) || hasList(x)) : isObj(v) && Object.values(v as object).some(hasList)

function formatJSON(v: unknown, indent = '', depth = 0, inList = false): string {
  if (!v || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  const flat = inlineJSON(v)
  if (depth > 0) {
    if (Array.isArray(v) && !v.some((x) => isObj(x) || (Array.isArray(x) && x.some(isObj)))) return flat
    if (flat.length <= 300 && (inList || !hasList(v))) return flat
  }
  const inner = indent + '  '
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return `[\n${v.map((x) => inner + formatJSON(x, inner, depth + 1, true)).join(',\n')}\n${indent}]`
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
  if (!entries.length) return '{}'
  const lines = entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatJSON(x, inner, depth + 1)}`)
  const tall = lines.map((l) => l.includes('\n'))
  return `{\n${lines.map((l, i) => (i && depth < 2 && (tall[i] || tall[i - 1]) ? '\n' : '') + l).join(',\n')}\n${indent}}`
}

function storyDataApi(): Plugin {
  return {
    name: 'story-data-api',
    configureServer(server) {
      fs.mkdirSync(ASSET_DIR, { recursive: true })
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://local')
        try {
          if (url.pathname === '/api/world' && req.method === 'GET') {
            if (!fs.existsSync(WORLD_FILE)) { res.statusCode = 404; return res.end() }
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
            if (!fs.existsSync(STAGING_FILE)) { res.statusCode = 404; return res.end() }
            const text = fs.readFileSync(STAGING_FILE, 'utf8')
            JSON.parse(text) // a broken file is an error the app must show, not an empty direction
            res.setHeader('content-type', 'application/json')
            return res.end(text)
          }
          if (url.pathname === '/api/staging' && req.method === 'PATCH') {
            const { ops } = JSON.parse((await readBody(req)).toString('utf8')) as { ops: StagingOp[] }
            if (!Array.isArray(ops)) throw new Error('expected { ops: [...] }')
            const current = fs.existsSync(STAGING_FILE) ? JSON.parse(fs.readFileSync(STAGING_FILE, 'utf8')) : { version: 1 }
            for (const op of ops) applyOp(current, op)
            const text = formatJSON(current) + '\n'
            fs.writeFileSync(STAGING_FILE + '.tmp', text)
            fs.renameSync(STAGING_FILE + '.tmp', STAGING_FILE)
            res.setHeader('content-type', 'application/json')
            return res.end(text)
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
            return res.end(`data/exports/${name}`)
          }
          if (url.pathname.startsWith('/data-assets/') && req.method === 'GET') {
            const file = path.join(ASSET_DIR, safeName(decodeURIComponent(url.pathname.slice(13))))
            if (!fs.existsSync(file)) { res.statusCode = 404; return res.end() }
            res.setHeader('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
            return res.end(fs.readFileSync(file))
          }
        } catch (e) {
          res.statusCode = 500
          return res.end(String(e))
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), storyDataApi()],
  resolve: {
    // One copy of three for the app and the engine files outside app/.
    alias: [
      { find: /^three$/, replacement: path.join(THREE_DIR, 'build/three.module.js') },
      { find: /^three\/addons\/(.*)$/, replacement: path.join(THREE_DIR, 'examples/jsm/$1') },
    ],
  },
  optimizeDeps: { exclude: ['three'] },
  // The engine (src/, assets/) sits outside app/, so let the dev server read the repo.
  server: { watch: { ignored: ['**/data/**'] }, fs: { allow: [REPO_DIR] } },
  build: { target: 'esnext' }, // the prop catalog loads its families with top-level await
})
