import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'

// Everything the canvas creates is saved inside the repo so it can be versioned with git.
const DATA_DIR = path.resolve(import.meta.dirname, '../data')
const ASSET_DIR = path.join(DATA_DIR, 'assets')
const WORLD_FILE = path.join(DATA_DIR, 'world.json')
const EXPORT_DIR = path.join(DATA_DIR, 'exports')

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
  server: { watch: { ignored: ['**/data/**'] } },
})
