/**
 * Chat stream 真实 provider E2E（UAT-E2E-REAL 就绪能力）
 *
 * 与 chat-stream.e2e.mjs 同构，但走**真实 LLM provider**（不设 DAVE_TEST_MOCK_PROVIDER）。
 * 通过环境变量注入凭据：
 *   DAVE_REAL_API_KEY  —— 必填（provider API key）
 *   DAVE_REAL_PROVIDER —— 可选，默认 openai（openai / anthropic / deepseek / custom）
 *   DAVE_REAL_MODEL    —— 可选，默认用主进程 provider 默认模型
 *
 * 无 key 时脚本输出 SKIP 并 exit 0（不污染本地门禁）；有 key 时执行真实全链路：
 *   UI 输入 → chat.stream(真实 provider) → 流式 start/chunk/done → 落库 user+assistant
 *
 * 用法：$env:DAVE_REAL_API_KEY="sk-..." ; node tests/chat-stream-real.e2e.mjs
 * 并需先 npm run build（加载 out/ 产物）。
 */
import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const API_KEY = process.env.DAVE_REAL_API_KEY?.trim()
if (!API_KEY) {
  process.stdout.write(
    "REAL-E2E SKIP: DAVE_REAL_API_KEY 未设置（真实 provider 全链路验证需用户提供 API Key）\n",
  )
  process.exit(0)
}

const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-real-e2e-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir }
delete env.DAVE_TEST_MOCK_PROVIDER // 真实 provider，禁用 mock
delete env.ELECTRON_RUN_AS_NODE

const consoleErrors = []
let app

try {
  app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForLoadState("domcontentloaded")
  window.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text())
  })
  window.on("pageerror", (e) => consoleErrors.push(String(e)))
  await window.waitForFunction(
    "() => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0 }",
    null,
    { timeout: 20_000 },
  )
  const input = window.locator('textarea[aria-label="input"]')
  await input.waitFor({ state: "visible", timeout: 20_000 })

  // 预置真实 API key + cwd（与真实 handler 前置一致）
  await window.evaluate(
    async ({ cwd, key }) => {
      await window.dave.store.set("openai-api-key", key)
      await window.dave.store.set("cwd", cwd)
    },
    { cwd: process.cwd(), key: API_KEY },
  )

  await window.getByRole("button", { name: "新对话" }).click()
  await input.waitFor({ state: "visible", timeout: 20_000 })

  process.stdout.write("real scene 1: ask streaming (real provider)\n")
  await input.fill("用一句话回复：你在运行吗？")
  await window.keyboard.press("Enter")

  // 真实响应无固定文本：以流式完成后消息落库为成功标准
  const persisted = await window.evaluate(async () => {
    for (let i = 0; i < 240; i++) {
      const list = await window.dave.session.list()
      const hit = list[0]
      if (hit) {
        const data = await window.dave.session.get(hit.id)
        if (Array.isArray(data?.messages) && data.messages.length >= 2) return data
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    return null
  })
  if (!persisted || !Array.isArray(persisted.messages) || persisted.messages.length < 2) {
    throw new Error("REAL-E2E FAIL: 真实流式未产生 user+assistant 落库（检查 key/额度/网络）")
  }
  const roles = persisted.messages.map((m) => m.role)
  const assistant = persisted.messages.find((m) => m.role === "assistant")
  if (!roles.includes("assistant") || !assistant?.content?.trim()) {
    throw new Error(`REAL-E2E FAIL: assistant 消息缺失或为空: ${roles.join(",")}`)
  }
  process.stdout.write(
    `real scene 1 passed (real provider reply, content length=${assistant.content.length})\n`,
  )

  if (consoleErrors.length > 0) {
    throw new Error(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`)
  }
  process.stdout.write("chat-stream REAL E2E passed (1 scene, no console errors)\n")
} catch (err) {
  process.stdout.write(`chat-stream REAL E2E FAILED: ${err instanceof Error ? err.message : String(err)}\n`)
  if (consoleErrors.length > 0) process.stdout.write(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}\n`)
  process.exitCode = 1
} finally {
  if (app) {
    try {
      await Promise.race([app.close(), delay(10_000).then(() => { throw new Error("close timeout") })])
    } catch {
      try {
        app.process().kill()
      } catch {
        /* ignore */
      }
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rm(userDataDir, { recursive: true, force: true })
      break
    } catch {
      if (attempt === 2) break
      await delay(500)
    }
  }
}