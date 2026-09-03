// 视觉回归对比脚本(VISUAL-BASELINE 闭合):重新截图 light/night 主界面,
// 与 tests/screenshots/baseline-<theme>.png 用 pixelmatch 做像素级 diff,
// 差异像素比例 > 1% 视为样式回归(退出码 1)。
//
// 用法:node tests/electron-visual-diff.mjs(需先 npm run build;基线由
// tests/electron-screenshot.mjs 生成)
import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"
import pngjs from "pngjs"
import pixelmatch from "pixelmatch"

const { PNG } = pngjs
const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-vdiff-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir }
delete env.ELECTRON_RUN_AS_NODE
const baseDir = join(process.cwd(), "tests", "screenshots")
const THRESHOLD_RATIO = 0.01 // 差异像素比例 >1% 视为回归
const app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })

try {
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForFunction("() => !!document.getElementById('root')?.childElementCount", null, {
    timeout: 20_000,
  })
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

  let failed = false
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
    const shot = await window.screenshot()
    const baselinePath = join(baseDir, `baseline-${theme}.png`)
    if (!existsSync(baselinePath)) {
      process.stdout.write(
        `VISUAL: missing baseline ${baselinePath} — run electron-screenshot.mjs first\n`,
      )
      failed = true
      continue
    }
    const baseline = PNG.sync.read(readFileSync(baselinePath))
    const current = PNG.sync.read(shot)
    if (baseline.width !== current.width || baseline.height !== current.height) {
      process.stdout.write(
        `VISUAL: size mismatch ${theme}: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}\n`,
      )
      failed = true
      continue
    }
    const diff = new PNG({ width: baseline.width, height: baseline.height })
    const mismatched = pixelmatch(
      baseline.data,
      current.data,
      diff.data,
      baseline.width,
      baseline.height,
      {
        threshold: 0.1,
      },
    )
    const ratio = mismatched / (baseline.width * baseline.height)
    const diffPath = join(baseDir, `diff-${theme}.png`)
    writeFileSync(diffPath, PNG.sync.write(diff))
    process.stdout.write(
      `VISUAL: ${theme} mismatched=${mismatched} ratio=${(ratio * 100).toFixed(2)}% diff=${diffPath}\n`,
    )
    if (ratio > THRESHOLD_RATIO) {
      process.stdout.write(
        `VISUAL: ${theme} EXCEEDS threshold ${THRESHOLD_RATIO * 100}% — 样式回归!\n`,
      )
      failed = true
    }
  }
  if (failed) process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  await rm(userDataDir, { recursive: true, force: true })
}
