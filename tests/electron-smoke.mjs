import { _electron as electron } from "playwright"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"

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
  process.stdout.write(`Electron smoke passed: ${title}\n`)
} finally {
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Electron close timeout")), 10_000),
      ),
    ])
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
}
