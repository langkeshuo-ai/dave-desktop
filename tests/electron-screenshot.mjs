// 视觉回归基线采集脚本(N5/P2-2):以 light / night 两种主题分别截图主界面,
// 生成 tests/screenshots/baseline-<theme>.png 作为样式回归基线。
//
// 用法:node tests/electron-screenshot.mjs(需先 npm run build)
// 对比:后续可用 pixelmatch / Playwright toHaveScreenshot 对基线 diff,
//       或直接人工查看两张基线是否与当前主题一致。
import { _electron as electron } from "playwright"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-shot-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir }
delete env.ELECTRON_RUN_AS_NODE
const outDir = join(process.cwd(), "tests", "screenshots")
await mkdir(outDir, { recursive: true })
const app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })

try {
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForFunction("() => !!document.getElementById('root')?.childElementCount", null, {
    timeout: 20_000,
  })
  // 跳过首启引导/向导(与 smoke 一致)
  const welcome = window.getByRole("dialog", { name: "欢迎使用 Dave Desktop" })
  if (await welcome.isVisible().catch(() => false)) await window.keyboard.press("Escape")
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

  for (const theme of ["light", "night"]) {
    await window.evaluate(async (t) => {
      await window.dave.store.set("theme", t)
    }, theme)
    await window.reload()
    await window.waitForFunction(
      "() => !!document.getElementById('root')?.childElementCount",
      null,
      { timeout: 20_000 },
    )
    await delay(800)
    const path = join(outDir, `baseline-${theme}.png`)
    await window.screenshot({ path })
    process.stdout.write(`screenshot saved: tests/screenshots/baseline-${theme}.png\n`)
  }
} finally {
  await app.close().catch(() => {})
  await rm(userDataDir, { recursive: true, force: true })
}
