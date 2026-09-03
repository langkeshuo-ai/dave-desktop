// 冷启动实测脚本(N1):启动后读取主进程 first_window_shown 遥测事件的
// elapsedMs(processStartedAt → ready-to-show),对照 COLD_WINDOW_BUDGET_MS(3s)
// 与 0.2.0 目标(<1.5s)。
//
// 用法:node tests/electron-coldstart.mjs(需先 npm run build)
import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
const userDataDir = await mkdtemp(join(tmpdir(), "dave-coldstart-"))
const env = { ...process.env, DAVE_TEST_USER_DATA: userDataDir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [process.cwd()], env })

try {
  const window = await app.firstWindow({ timeout: 45_000 })
  await window.waitForFunction("() => !!document.getElementById('root')?.childElementCount", null, {
    timeout: 20_000,
  })
  // 等主进程打完 first_window_shown 点并落库
  await delay(1500)
  const events = await window.evaluate(() => window.dave.telemetry.events())
  const shown = events.find((e) => e.name === "first_window_shown")
  if (!shown) {
    process.stdout.write("COLDSTART: no first_window_shown event\n")
  } else {
    process.stdout.write(
      "COLDSTART: " +
        JSON.stringify({
          elapsedMs: shown.props?.elapsedMs,
          withinBudget3s: shown.props?.within,
          budgetMs: shown.props?.budgetMs,
        }) +
        "\n",
    )
  }
} finally {
  await app.close().catch(() => {})
  await rm(userDataDir, { recursive: true, force: true })
}
