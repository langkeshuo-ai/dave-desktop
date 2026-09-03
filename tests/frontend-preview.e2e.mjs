/**
 * frontend-preview E2E 验证门禁
 *
 * 每个断言对应一个具名风险（named risk），失败即阻断：
 *   R1  外壳渲染 —— risk: 活动栏/侧栏/主区/输入区缺失
 *   R2  流式回放启动 —— risk: 回放脚本未运行或流式 UI 未接
 *   R3  审批步骤可见 —— risk: 写文件审批开关未呈现
 *   R4  审批可点（遮挡回归）—— risk: 令牌被输入区遮挡无法点击
 *   R5  补丁预览开/关 —— risk: diff 弹层不可用
 *   R6  撤销令牌 —— risk: 回滚语义丢失
 *   R7  输入发送闭环 —— risk: composer 发送/回复链路断裂
 *   R8  模式切换 —— risk: mode pill 不可交互
 *   R9  新对话空态 —— risk: 会话重置失败
 *   R10 会话搜索过滤 —— risk: 列表过滤失效
 *   R11 运行状态指示 —— risk: 忙碌指示/顶部琥珀流不可见
 *   R12 无控制台错误 —— risk: 运行时 JS 异常
 *
 * 用法：node tests/frontend-preview.e2e.mjs   （自动拉起静态服务器）
 * 依赖：项目 devDependencies 中的 playwright（需已安装 chromium：
 *       npx playwright install chromium）
 */
import { spawn } from "node:child_process"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = 5188
const BASE = `http://localhost:${PORT}/`

let passed = 0
const failures = []

function check(name, ok, detail = "") {
  if (ok) {
    passed++
    console.log(`  ok  ${name}`)
  } else {
    failures.push(name)
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`)
  }
}

function waitPort(timeoutMs = 8000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(BASE)
        if (r.status < 500) return resolve()
      } catch { /* not ready */ }
      if (Date.now() - start > timeoutMs) return reject(new Error("server not ready"))
      setTimeout(tick, 200)
    }
    tick()
  })
}

const server = spawn(process.execPath, ["frontend-preview/server.mjs"], {
  cwd: root,
  stdio: "ignore",
  env: { ...process.env, PORT: String(PORT) },
})

let browser
try {
  await waitPort()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const consoleErrors = []
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
  page.on("pageerror", (e) => consoleErrors.push(String(e)))

  await page.goto(BASE, { waitUntil: "domcontentloaded" })

  // R1 外壳渲染
  await page.waitForSelector(".activity", { timeout: 5000 }).catch(() => {})
  check("R1 外壳渲染（活动栏/侧栏/主区/输入区）",
    !!(await page.$(".activity")) && !!(await page.$(".sidebar")) && !!(await page.$(".main")) && !!(await page.$("#input")),
  )

  // R2 流式回放启动：等待助手文本 + 动作轨道 read_file 步骤出现
  const rd = await page.waitForSelector(".action.run", { timeout: 15000 }).catch(() => null)
  check("R2 流式回放启动（动作步骤出现）", !!rd)
  const assistText = await page.locator(".assist-msg .stream").first().textContent().catch(() => "")
  check("R2b 助手流式文本非空", (assistText || "").length > 0)

  // 等待写文件审批步骤（writed 待确认）
  await page.waitForSelector(".action.writed", { timeout: 15000 }).catch(() => {})
  const wbtn = await page.$(".action.writed")
  check("R3 审批步骤可见（writed 待确认）", !!wbtn)

  // R11 运行状态指示：忙碌时顶部琥珀流可见（非 hide）
  const flowHidden = await page.$eval("#sbFlow", (el) => el.classList.contains("hide")).catch(() => null)
  check("R11 运行状态指示（琥珀脉搏流可见）", flowHidden === false)

  // R4 审批可点：点击允许，令牌出现，且令牌不被输入区遮挡
  if (wbtn) {
    const okBtn = await wbtn.$(".approve .ok")
    if (okBtn) {
      await okBtn.click().catch(() => {})
    }
  }
  await page.waitForSelector(".tray .token", { timeout: 8000 }).catch(() => {})
  const token = await page.$(".tray .token")
  check("R4a 允许审批 → 变更令牌出现", !!token)
  if (token) {
    const tb = await token.boundingBox()
    const hintB = await page.$eval(".comp-hint", (el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    }).catch(() => null)
    const tokenAbove = hintB ? tb.y + tb.height <= hintB.top + 1 : true
    check("R4b 令牌位于输入区之上（遮挡回归已修）", tokenAbove,
      tokenAbove ? "" : `tokenBottom=${(tb.y + tb.height).toFixed(0)} hintTop=${hintB.top.toFixed(0)}`)
  }

  // R5 补丁预览开/关
  if (token) {
    await page.click(".tray .token .peek").catch(() => {})
    await page.waitForSelector(".diff-pop.open", { timeout: 4000 }).catch(() => {})
    check("R5a 查看补丁 → diff 弹层打开", !!(await page.$(".diff-pop.open")))
    await page.click("#diffClose").catch(() => {})
    await page.waitForSelector(".diff-pop", { state: "detached" }).then(
      () => check("R5b 关闭 diff 弹层", true),
      async () => check("R5b 关闭 diff 弹层", !(await page.$(".diff-pop.open"))),
    )
  }

  // R6 撤销令牌
  if (token) {
    await page.click(".tray .token .undo").catch(() => {})
    await page.waitForSelector(".tray .token", { state: "detached", timeout: 4000 })
      .then(() => check("R6a 撤销后令牌移除", true), () => check("R6a 撤销后令牌移除", false))
    const denied = await page.$(".action.denied")
    check("R6b 对应动作标记已回滚", !!denied)
  }

  // R7 输入发送闭环（回放已结束进入就绪态）
  await page.fill("#input", "继续翻译 docs/ 下的文档")
  await page.keyboard.press("Enter")
  await page.waitForSelector(".user-msg", { timeout: 5000 }).catch(() => {})
  check("R7a 发送后用户消息上屏", !!(await page.$(".user-msg")))
  await page.waitForSelector(".assist-msg .stream", { timeout: 8000 }).catch(() => {})
  const lastStreams = page.locator(".assist-msg .stream")
  const lastText = (await lastStreams.last().textContent().catch(() => "")) || ""
  check("R7b 助手流式回复出现", lastText.length > 0)

  // R8 模式切换
  await page.click('#modePill button[data-mode="auto"]').catch(() => {})
  const autoActive = await page.$eval('#modePill button[data-mode="auto"]', (el) =>
    el.classList.contains("active"),
  ).catch(() => false)
  check("R8 模式切换生效", autoActive === true)

  // R9 新对话空态
  await page.click("#newChat").catch(() => {})
  await page.waitForSelector(".empty", { timeout: 4000 }).catch(() => {})
  check("R9 新对话空态出现", !!(await page.$(".empty")))
  const colEmpty = await page.$eval("#col", (el) => el.querySelectorAll(".assist-msg").length === 0).catch(() => false)
  check("R9b 消息列已清空", colEmpty)

  // R10 会话搜索过滤
  await page.fill("#sessSearch", "排查")
  const visibleAfter = await page.$$eval(".sess-item:not([style*='display: none'])", (els) => els.length).catch(() => -1)
  check("R10 会话搜索过滤生效", visibleAfter >= 1 && visibleAfter < 3, `visible=${visibleAfter}`)
  await page.fill("#sessSearch", "")

  // R12 无控制台错误
  check("R12 无控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "))

  await browser.close()
} catch (err) {
  failures.push("E2E runner error")
  console.log(`FAIL  E2E runner error — ${err.message}`)
} finally {
  server.kill()
}

console.log(`\nResult: ${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log("Failed checks: " + failures.join(", "))
  process.exit(1)
}
process.exit(0)