/**
 * Electron UAT — 新链用户验收测试（v0.4 重写版，2026-09-03）
 *
 * 面向新 renderer（Activity Bar + 设置面板 + 真实会话链路），旧 UI 版本已删除。
 * 场景覆盖：
 *   1. 启动 + 主界面渲染（活动栏/侧栏/输入框）
 *   2. 设置面板打开（role=dialog）→ 扩展 tab 添加技能 → 列表出现
 *   3. 关于 tab 版本非空
 *   4. 关闭 → 重开 → 技能持久化保留
 *   5. 删除技能 → 列表清空
 *   6. 无 console 错误
 *
 * 用法：node tests/electron-uat.mjs（需先 npm run build）
 * 由 verify-full.mjs 承接（uat 步骤）。
 */
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

const consoleErrors = []
let app

function attachConsole(w) {
  w.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text())
  })
  w.on("pageerror", (e) => consoleErrors.push(String(e)))
}

function pass(name) {
  process.stdout.write(`PASS  ${name}\n`)
}

try {
  app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForLoadState("domcontentloaded")
  attachConsole(window)
  await window.waitForFunction(
    "() => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0 }",
    null,
    { timeout: 20_000 },
  )

  // 1. 主界面渲染
  await window.getByRole("button", { name: "设置" }).waitFor({ state: "visible", timeout: 15_000 })
  await window.locator('textarea[aria-label="input"]').waitFor({ state: "visible", timeout: 15_000 })
  pass("应用启动,主界面渲染")

  // 2. 设置面板 → 扩展 tab 添加技能
  await window.getByRole("button", { name: "设置" }).click()
  const dialog = window.getByRole("dialog", { name: "设置" })
  await dialog.waitFor({ state: "visible", timeout: 15_000 })
  pass("设置面板打开 (role=dialog)")

  await window.getByRole("button", { name: "扩展" }).click()
  const skillName = "uat-skill"
  await window.getByPlaceholder("名称").fill(skillName)
  await window.getByPlaceholder("描述").fill("UAT 验收技能")
  await window.getByPlaceholder("内容").fill("按 UAT 步骤执行的指令内容")
  await window.getByRole("button", { name: "添加技能" }).click()
  const skillItem = window.getByText(skillName, { exact: true })
  await skillItem.waitFor({ state: "visible", timeout: 10_000 })
  pass("扩展 tab:添加技能 → 列表出现")

  // 3. 关于 tab 版本非空
  await window.getByRole("button", { name: "关于" }).click()
  await window.getByText("版本", { exact: true }).waitFor({ state: "visible", timeout: 5_000 })
  pass("关于 tab:版本区渲染")

  // 4. 关闭 → 重开 → 技能持久化保留
  await window.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden", timeout: 5_000 })
  await window.getByRole("button", { name: "设置" }).click()
  await dialog.waitFor({ state: "visible", timeout: 10_000 })
  await window.getByRole("button", { name: "扩展" }).click()
  await window.getByText(skillName, { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
  pass("技能持久化:关闭重开后保留")

  // 5. 删除技能 → 列表清空
  await window.getByRole("button", { name: "删除" }).click()
  await window.getByText(skillName, { exact: true }).waitFor({ state: "hidden", timeout: 10_000 })
  pass("删除技能 → 列表清空")

  // 6. 无 console 错误
  if (consoleErrors.length > 0) {
    throw new Error(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`)
  }
  process.stdout.write("UAT ALL PASS (6 scenes, no console errors)\n")
} catch (err) {
  process.stdout.write(`UAT FAILED: ${err instanceof Error ? err.message : String(err)}\n`)
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