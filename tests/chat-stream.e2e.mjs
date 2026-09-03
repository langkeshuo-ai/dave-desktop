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
 *   3. 重启恢复渲染：同 userDataDir 重启 → session.get → ChatView 渲染历史消息
 *   4. 设置面板：ActivityBar 设置 → role=dialog 可见 → tab 渲染 → Esc 关闭
 *
 * 成功标准：四场景断言 + 无控制台错误。失败即退出码非 0。
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

function attachConsole(w) {
  w.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text())
  })
  w.on("pageerror", (e) => consoleErrors.push(String(e)))
}

try {
  app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForLoadState("domcontentloaded")
  attachConsole(window)

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

  // 创建首个真实会话（空列表时会话 id 为空，必须在输入前先建会话）
  await window.getByRole("button", { name: "新对话" }).click()
  await input.waitFor({ state: "visible", timeout: 20_000 })

  // ── 场景 1：ask 流式 ──
  process.stdout.write("scene 1: ask streaming\n")
  await input.fill("你好 Dave")
  await window.keyboard.press("Enter")
  const askText = window.getByText("这是 mock 回复：你好 Dave", { exact: false })
  await askText.first().waitFor({ state: "visible", timeout: 20_000 })
  process.stdout.write("scene 1 passed (ask final text rendered)\n")

  // H1 验证：流式完成后会话消息已落库（user + assistant，重启后 session.get 可恢复）
  // 轮询等待：自动命名（updateTitle）与消息落库均为异步 IPC，避免时序竞态
  const persisted = await window.evaluate(async (titlePrefix) => {
    for (let i = 0; i < 50; i++) {
      const list = await window.dave.session.list()
      const hit = list.find((s) => (s.title || "").startsWith(titlePrefix))
      if (hit) {
        const data = await window.dave.session.get(hit.id)
        if (Array.isArray(data?.messages) && data.messages.length >= 2) return data
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  }, "你好 Dave")
  if (!persisted || !Array.isArray(persisted.messages) || persisted.messages.length < 2) {
    throw new Error("H1: 会话消息未落库（期望至少 user+assistant 两条）")
  }
  const roles = persisted.messages.map((m) => m.role)
  if (roles[0] !== "user" || !roles.includes("assistant")) {
    throw new Error(`H1: 消息角色不符: ${roles.join(",")}`)
  }
  process.stdout.write("scene 1b passed (messages persisted: user+assistant)\n")

  // ── 场景 2：agent 工具审批 ──
  process.stdout.write("scene 2: agent approval\n")
  await window.evaluate(async () => {
    await window.dave.store.set("mode", "auto")
  })
  await input.waitFor({ state: "visible", timeout: 20_000 })
  // 场景 2 继续使用同一会话（已创建）
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

  // A2' 断言：执行轨迹卡（done 后补拉聚合 role:"tool" 消息）出现，展开可见工具名与输出
  const traceBtn = window.getByRole("button", { name: /执行轨迹/ })
  await traceBtn.waitFor({ state: "visible", timeout: 15_000 })
  await traceBtn.click()
  const traceTool = window.getByText(/file_tree/, { exact: false })
  await traceTool.first().waitFor({ state: "visible", timeout: 5_000 })
  process.stdout.write("scene 2b passed (exec trace card rendered: file_tree)\n")

  // ── 场景 3：重启恢复渲染（落库数据 → 重启 → ChatView 渲染历史） ──
  process.stdout.write("scene 3: restart resume rendering\n")
  const persistedSessionId = await window.evaluate(async () => {
    const list = await window.dave.session.list()
    return list.length > 0 ? list[0].id : ""
  })
  if (!persistedSessionId) throw new Error("scene 3: no persisted session found")
  await app.close()
  app = null

  // 同一 userDataDir 重启（消息保持落库）
  app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })
  const window2 = await app.firstWindow({ timeout: 45_000 })
  await window2.waitForLoadState("domcontentloaded")
  attachConsole(window2)
  await window2.waitForFunction(
    "() => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0 }",
    null,
    { timeout: 20_000 },
  )

  // ChatView 挂载后补拉 session.get 渲染历史 assistant 消息
  const resumeText = window2.getByText("这是 mock 回复：你好 Dave", { exact: false })
  await resumeText.first().waitFor({ state: "visible", timeout: 25_000 })

  const restoredRoles = await window2.evaluate(async (sid) => {
    const data = await window.dave.session.get(sid)
    return (data?.messages ?? []).map((m) => m.role)
  }, persistedSessionId)
  if (!restoredRoles.includes("assistant")) {
    throw new Error(`scene 3: restored session lacks assistant message: ${restoredRoles.join(",")}`)
  }
  process.stdout.write("scene 3 passed (history rendered after restart)\n")

  // ── 场景 4：设置面板（SETTINGS-FS 视图回归：打开→tab 渲染→Esc 关闭） ──
  process.stdout.write("scene 4: settings panel\n")
  await window2.getByRole("button", { name: "设置" }).click()
  const settingsDialog = window2.getByRole("dialog", { name: "设置" })
  await settingsDialog.waitFor({ state: "visible", timeout: 15_000 })
  await window2.getByRole("button", { name: "关于" }).waitFor({ state: "visible", timeout: 5_000 })
  await window2.keyboard.press("Escape")
  await settingsDialog.waitFor({ state: "hidden", timeout: 5_000 })
  process.stdout.write("scene 4 passed (settings panel open/close)\n")

  // ── 无控制台错误 ──
  if (consoleErrors.length > 0) {
    throw new Error(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`)
  }
  process.stdout.write("chat-stream E2E passed (4 scenes + no console errors)\n")
} catch (err) {
  process.stdout.write(
    `chat-stream E2E FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  if (consoleErrors.length > 0)
    process.stdout.write(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}\n`)
  process.exitCode = 1
} finally {
  if (app) {
    try {
      await Promise.race([
        app.close(),
        delay(10_000).then(() => {
          throw new Error("close timeout")
        }),
      ])
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
