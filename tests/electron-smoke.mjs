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
  // 使用字符串形式，避免 Node 侧 ESLint 对 browser document 的 no-undef
  await window.waitForFunction(
    "() => { const root = document.getElementById('root'); return !!root && root.childElementCount > 0 }",
    null,
    { timeout: 20_000 },
  )

  // 快捷键帮助面板：? 键可打开（非输入态）
  await window.keyboard.press("Shift+Slash")
  const help = window.getByRole("dialog", { name: "键盘快捷键" })
  await help.waitFor({ state: "visible", timeout: 5_000 })
  await window.keyboard.press("Escape")
  await help.waitFor({ state: "hidden", timeout: 5_000 })

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
