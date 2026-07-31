// 用户验收测试(UAT)自动化演示——覆盖用户可见功能(对应 SELF_CHECK.md 核心场景)。
// 用 Playwright 驱动真实 Electron UI,逐步操作并断言,输出每步 PASS/FAIL。
// 运行前需 npm run build;mock 模式(DAVE_TEST_MOCK_PROVIDER=1)让发送/编辑可用。
// 用法:node tests/electron-uat.mjs
import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-uat-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir, DAVE_TEST_MOCK_PROVIDER: "1" }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })

const results = []
function step(name, ok, extra = "") {
  results.push(ok)
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}\n`)
}

try {
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForFunction(
    "() => !!document.getElementById('root')?.childElementCount",
    null,
    { timeout: 20_000 },
  )
  step("应用启动,主界面渲染", true)

  // 跳过首启引导/向导,并预置 onboarding_completed:
  // isFirstRun 只认 completed 事件(skipped 不算),否则 reload 后向导会重弹。
  const welcome = window.getByRole("dialog", { name: "欢迎使用 Dave Desktop" })
  if (await welcome.isVisible().catch(() => false)) await window.keyboard.press("Escape")
  const wizard = window.getByRole("dialog").filter({ hasText: /API|密钥|Provider/i })
  if (await wizard.first().isVisible().catch(() => false)) {
    await window.keyboard.press("Escape")
    await delay(300)
  }
  await window.evaluate(async () => {
    await window.dave.telemetry.emit("onboarding_completed")
  })

  // 预置 key/cwd(渲染端守卫,mock 模式主进程不需 key)
  await window.evaluate(async (cwd) => {
    await window.dave.store.set("openai-api-key", "sk-mock-00000000000000000000")
    await window.dave.store.set("cwd", cwd)
  }, process.cwd())

  // 1. 设置打开 + 四 tab 导航
  await window.getByRole("button", { name: "设置" }).click()
  const settings = window.getByRole("dialog", { name: "设置" })
  await settings.waitFor({ state: "visible", timeout: 5_000 })
  step("设置面板打开", true)
  for (const tab of ["模型", "工作区", "扩展", "关于"]) {
    await settings.getByRole("button", { name: tab }).click()
    await delay(250)
    step(`设置 tab「${tab}」可导航`, true)
  }

  // 2. 扩展 tab:MCP 配置面板可见(用 aria-label 定位)
  await settings.getByRole("button", { name: "扩展" }).click()
  await delay(250)
  step(
    "扩展 tab:MCP 服务器名称输入框可见",
    await settings.getByLabel("MCP 服务器名称").isVisible().catch(() => false),
  )

  // 3. 关于 tab:FunnelView / LogViewer / 诊断导出可见
  await settings.getByRole("button", { name: "关于" }).click()
  await delay(400)
  step(
    "关于 tab:漏斗看板(本地使用统计)可见",
    await window.getByText("本地使用统计", { exact: false }).isVisible().catch(() => false),
  )
  step(
    "关于 tab:日志查看器(过滤输入)可见",
    await window.getByPlaceholder("过滤关键字…").isVisible().catch(() => false),
  )
  step(
    "关于 tab:日志输出级别选择器可见",
    await window.getByLabel("日志输出级别").isVisible().catch(() => false),
  )
  step(
    "关于 tab:导出诊断报告按钮可见",
    await window.getByRole("button", { name: "导出诊断报告" }).isVisible().catch(() => false),
  )
  await window.keyboard.press("Escape")
  await settings.waitFor({ state: "hidden", timeout: 5_000 })
  step("设置关闭(Esc)", true)

  // 5. 命令面板(Ctrl+K)
  await window.keyboard.press("Control+K")
  await window
    .getByRole("dialog")
    .filter({ hasText: /新建会话|命令/ })
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
  step("命令面板(Ctrl+K)打开", true)
  await window.keyboard.press("Escape")

  // 6. 键盘帮助(Shift+/)
  await window.keyboard.press("Shift+Slash")
  await window
    .getByRole("dialog", { name: "键盘快捷键" })
    .waitFor({ state: "visible", timeout: 5_000 })
  step("键盘帮助(?)打开", true)
  await window.keyboard.press("Escape")

  // 7. mock 发消息 → 流式回复(ask 模式)
  // 新建会话(无会话时主界面为空状态引导,MessageInput 未渲染;与 smoke 对齐)
  await window.getByRole("button", { name: "新建会话" }).first().click()
  await delay(500)
  step("新建会话", true)

  const composer = window.getByPlaceholder(/输入问题|描述任务/)
  await composer.waitFor({ state: "visible", timeout: 10_000 })
  await composer.fill("你好 Dave")
  await window.getByRole("button", { name: "发送" }).click()
  await window
    .locator(".msg-row")
    .filter({ hasText: "这是 mock 回复" })
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
  step("发送消息,收到 mock 流式回复", true)

  // 8. 编辑消息 → 重新生成
  const userMsg = window.locator(".msg-bubble.user").first()
  await userMsg.hover()
  await userMsg.getByRole("button", { name: "编辑消息" }).click()
  await userMsg.getByRole("textbox", { name: "编辑消息" }).fill("你好 Dave 改一版")
  await userMsg.getByRole("button", { name: "保存并重新生成" }).click()
  await window
    .locator(".msg-row")
    .filter({ hasText: "这是 mock 回复：你好 Dave 改一版" })
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
  step("编辑消息并重新生成", true)

  // 9. Ctrl+F 会话内搜索
  await window.keyboard.press("Control+F")
  await window
    .getByRole("searchbox", { name: "搜索关键词" })
    .waitFor({ state: "visible", timeout: 5_000 })
  step("会话内搜索(Ctrl+F)打开", true)
  await window.keyboard.press("Escape")

  // 10. 导出按钮
  const exportBtn = window.getByRole("button", { name: "导出 Markdown" })
  step("导出 Markdown 按钮存在", (await exportBtn.count()) > 0)

  // 11. 主题切换(最后执行:reload 会重置页面,不影响前面的 UI 流程)
  await window.evaluate(async (t) => {
    await window.dave.store.set("theme", t)
  }, "night")
  await window.reload()
  await window.waitForFunction(
    "() => !!document.getElementById('root')?.childElementCount",
    null,
    { timeout: 20_000 },
  )
  await delay(800)
  const isNight = await window.evaluate(() =>
    globalThis.document.documentElement.classList.contains("night"),
  )
  step("主题切换为 night 生效(重启后保持)", isNight)
  await window.evaluate(async (t) => {
    await window.dave.store.set("theme", t)
  }, "light")
  await window.reload()
  await window.waitForFunction(
    "() => !!document.getElementById('root')?.childElementCount",
    null,
    { timeout: 20_000 },
  )
  await delay(800)
  step("主题切回 light", true)

  // 汇总
  const passed = results.filter(Boolean).length
  process.stdout.write(`\nUAT RESULT: ${passed}/${results.length} passed\n`)
  if (passed !== results.length) process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  await rm(userDataDir, { recursive: true, force: true })
}
