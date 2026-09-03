// 最小静态文件服务器：预览 frontend-preview 原型（npm run preview:ui）
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const root = normalize(join(fileURLToPath(import.meta.url), ".."))
const port = Number(process.env.PORT || 5177)

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname)
    if (urlPath === "/") urlPath = "/index.html"
    const file = normalize(join(root, urlPath))
    if (!file.startsWith(root)) {
      res.writeHead(403)
      res.end("forbidden")
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end("not found")
  }
})

server.listen(port, () => {
  console.log(`Dave Desktop UI preview: http://localhost:${port}/`)
})