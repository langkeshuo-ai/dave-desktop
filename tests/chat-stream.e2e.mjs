/**
 * Chat stream 真实会话 E2E —— 驱动打包后的 Electron + mock provider
 *
 * 链路（真实全链路，不触网）：
 *   UI 输入 → window.dave.chat.stream → 主进程 handleChatStream(mock)
 *   → pushWithGuard 推送 start/chunk(/tools/approval/patch)/done
 *   → preload 监听 → use-chat-stream-bridge → store.dispatch
 *   → useChatStreamStore 驱动 ChatView 渲染 → done 落常驻消息
 *
 * 场景：
 *   1. ask 模式：输入 → 流式文本 → done，最终文本 = mockReplyText(msg, "ask")
 *   2. agent 模式：store.mode=auto → 输入 → ApprovalCard 出现 → 点允许
 *      → 工具轮完成后最终文本含 "（mock 工具轮已完成，模式=auto）"
 *
 * 成功标准：两场景文本断言 + 无控制台错误。失败即退出码非 0。
 * 运行：npm run build && node tests/chat-stream.e2e.mjs
 */
import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-chat-e2e-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir, DAVE_TEST_MOCK_PROVIDER: "1" }
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

  // 渲染挂载
  await window.waitForFunction(
    "() => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0 }",
    null,
    { timeout: 20_000 },
  )
  const input = window.locator('textarea[aria-label="input"]')
  await input.waitFor({ state: "visible", timeout: 20_000 })

  // 预置 key/cwd（传递：mock 分支本不需要 key，但保持与真实 handler 前置一致）
  await window.evaluate(async (cwd) => {
    await window.dave.store.set("openai-api-key", "sk-mock-00000000000000000000")
    await window.dave.store.set("cwd", cwd)
  }, process.cwd())

  // ── 场景 1：ask 流式 ──
  process.stdout.write("scene 1: ask streaming\n")
  await input.fill("你好 Dave")
  await window.keyboard.press("Enter")
  const askText = window.getByText("这是 mock 回复：你好 Dave", { exact: false })
  await askText.first().waitFor({ state: "visible", timeout: 20_000 })
  process.stdout.write("scene 1 passed (ask final text rendered)\n")

  // ── 场景 2：agent 工具审批 ──
  process.stdout.write("scene 2: agent approval\n")
  await window.evaluate(async () => {
    await window.dave.store.set("mode", "auto")
  })
  await input.fill("帮我处理文件")
  await window.keyboard.press("Enter")
  // 审批卡出现并点击允许
  const allow = window.getByRole("button", { name: "允许" })
  await allow.waitFor({ state: "visible", timeout: 15_000 })
  await allow.click()
  // 工具轮后最终回复
  const agentText = window.getByText(
    "这是 mock 回复：帮我处理文件 （mock 工具轮已完成，模式=auto）",
    { exact: false },
  )
  await agentText.first().waitFor({ state: "visible", timeout: 20_000 })
  process.stdout.write("scene 2 passed (agent approval + final text rendered)\n")

  // ── 无控制台错误 ──
  if (consoleErrors.length > 0) {
    throw new Error(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`)
  }
  process.stdout.write("chat-stream E2E passed (2 scenes + no console errors)\n")
} catch (err) {
  process.stdout.write(`chat-stream E2E FAILED: ${err instanceof Error ? err.message : String(err)}\n`)
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