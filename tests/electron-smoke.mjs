import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-electron-smoke-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })
try {
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForLoadState("domcontentloaded")
  process.stdout.write("Electron window created\n")

  const title = await window.title()
  const rootVisible = await window.locator("#root").isVisible()
  if (title !== "Dave Desktop") throw new Error(`unexpected title: ${title}`)
  if (!rootVisible) throw new Error("renderer root is not visible")

  // CSP meta 必须存在（纵深防御基线）
  const csp = await window
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content")
  if (!csp || !csp.includes("default-src 'self'")) {
    throw new Error(`CSP meta missing or weak: ${csp}`)
  }
  if (csp.includes("script-src") && csp.includes("'unsafe-eval'")) {
    throw new Error("CSP must not allow unsafe-eval")
  }

  // 渲染树应在短时间内挂载 React 内容（非空 root）
  await window.waitForFunction(
    "() => { const root = document.getElementById('root'); return !!root && root.childElementCount > 0 }",
    null,
    { timeout: 20_000 },
  )

  // 首启欢迎页：跳过，避免挡住后续 UI
  const welcome = window.getByRole("dialog", { name: "欢迎使用 Dave Desktop" })
  if (await welcome.isVisible().catch(() => false)) {
    const skip = window.getByRole("button", { name: "跳过欢迎页" })
    if (await skip.isVisible().catch(() => false)) {
      await skip.click()
    } else {
      await window.keyboard.press("Escape")
    }
    await welcome.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {})
  }

  // API Key 向导若出现，Esc 关掉（无 Key 场景只验证 UI 可达）
  const wizard = window.getByRole("dialog").filter({ hasText: /API|密钥|Provider/i })
  if (
    await wizard
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await window.keyboard.press("Escape")
    await delay(300)
  }

  // 快捷键帮助面板：? 键可打开（非输入态）
  await window.keyboard.press("Shift+Slash")
  const help = window.getByRole("dialog", { name: "键盘快捷键" })
  await help.waitFor({ state: "visible", timeout: 5_000 })
  // 帮助文案应包含编辑相关说明或 Esc 停止
  const helpText = await help.innerText()
  if (!helpText.includes("Esc")) {
    throw new Error("keyboard help missing Esc shortcut")
  }
  await window.keyboard.press("Escape")
  await help.waitFor({ state: "hidden", timeout: 5_000 })

  // 命令面板 Ctrl+K
  await window.keyboard.press("Control+K")
  const palette = window
    .locator(".cmdk-panel, [role='dialog']")
    .filter({ hasText: /新建会话|命令/ })
  await palette.first().waitFor({ state: "visible", timeout: 5_000 })
  await window.keyboard.press("Escape")

  // 设置按钮
  await window.getByRole("button", { name: "设置" }).click()
  const settings = window.getByRole("dialog", { name: "设置" })
  await settings.waitFor({ state: "visible", timeout: 5_000 })
  await window.keyboard.press("Escape")
  await settings.waitFor({ state: "hidden", timeout: 5_000 })

  // 新建会话（顶栏或侧栏）
  const newSession = window.getByRole("button", { name: "新建会话" }).first()
  await newSession.click()
  await delay(400)

  // 导出按钮在空会话应 disabled；存在即表示 ChatView 已挂载
  const exportBtn = window.getByRole("button", { name: "导出 Markdown" })
  if (await exportBtn.count()) {
    const disabled = await exportBtn.isDisabled()
    if (!disabled) {
      // 允许已有历史消息的情况；至少按钮存在
      process.stdout.write("export button present (enabled)\n")
    } else {
      process.stdout.write("export button present (disabled on empty)\n")
    }
  }

  process.stdout.write(`Electron smoke passed: ${title}\n`)
} finally {
  try {
    await Promise.race([
      app.close(),
      delay(10_000).then(() => {
        throw new Error("Electron close timeout")
      }),
    ])
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
}
