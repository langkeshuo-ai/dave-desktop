import { spawn, spawnSync, type ChildProcess } from "child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { DoctorCommand } from "./cli/cmd/doctor"
import { CalendarCommand } from "./cli/cmd/dave/cal"
import { GoalCommand } from "./cli/cmd/dave/goal"
import { DaveStatusCommand } from "./cli/cmd/dave/status"
import { BrainCommand } from "./cli/cmd/dave/brain"
import {
  ADVANCED_COMMANDS,
  describeMapMode,
  firstNonFlag,
  hasFlag,
  isBareAgentUiArgv,
  isInteractiveAgentArgv,
  mapDaveArgsToOpencode,
  resolveBareDaveArgv
} from "./cli/dave-map"
import { formatPreflightFailure, preflightDefaultProvider } from "./cli/dave-auth-preflight"
import { mayBeSelfCompiledAgent, nativeAgentCandidates, preferBunRuntimeForDev } from "./cli/dave-native"
import { allowDevBypass as allowDevBypassFlag } from "./cli/dave-dev-bypass"
import { cmdSetAssignmentsFromEnv, conhostCmdArgs } from "./cli/dave-win-cmd"

const args = hideBin(process.argv)
const STABLE_COMMANDS = new Set(["doctor", "status", "goal", "cal"])
const INTERNAL_COMMANDS = new Set(["audit"])
/** Memory is default-on product surface (not stable table, not staged-closed). */
const MEMORY_COMMANDS = new Set(["brain"])
const STAGED_COMMANDS = new Set(["evolve"])
// upgrade/uninstall stay outside advanced passthrough: they still target upstream install channels.
const FROZEN_CHANNEL_COMMANDS = new Set(["upgrade", "uninstall"])

function showHelp() {
  // Info → stdout so Windows terminals do not paint help as red "errors".
  process.stdout.write(
    [
      "dave — 戴夫 CLI（本地个人 Agent 工作台，不是 skill 商店）",
      "",
      "Usage:",
      "  dave                         交互终端 → 全屏 Agent TUI；管道/非 TTY → 本指南",
      "  dave --help                  始终显示本指南",
      "",
      "稳定命令:",
      "  dave doctor                  诊断环境与配置（含模型鉴权预检）",
      "  dave status                  显示 Dave 稳定面状态面板",
      "  dave goal <command>          管理目标",
      "  dave cal <command>           管理日程",
      "",
      "编程 Agent UI（写代码对话；非稳定面；不是 brain / skills）:",
      "  默认 UI = 全屏终端 TUI（full-screen）。只有显式 --mini 才走轻量 UI。",
      "  dave                         推荐：交互终端直接进入全屏 TUI（等同 dave tui）",
      "  dave tui                     显式全屏 TUI（默认 bun+dist/index.js；已验证 native PE 才用）",
      "  dave tui --mini              可选：轻量 UI（非默认；需显式指定）",
      "  dave --yolo                  全屏 TUI + 自动批准权限（明确危险）",
      "  dave --yolo \"修这个 bug\"     同上 + 启动时注入初始提示词",
      "  dave --mini                  单独 --mini：轻量 UI（默认仍不启用）",
      "  dave web                     浏览器界面",
      "  dave run \"prompt\"            非交互跑一轮后退出",
      "",
      "安全承诺:",
      "  默认模式                     稳定命令仅本地读写",
      "  危险 Agent 模式              需显式 --yolo / --dangerously-skip-permissions（自动批准工具）",
      "  skills / 市场                不属于稳定产品面",
      "  Windows Terminal             全屏 TUI 会自动改用 conhost 新窗口（WT 与 opentui 不兼容）",
      "  model auth                   进入 Agent UI 前预检默认模型密钥；失败直接退出并给修复步骤",
      "",
      "内部治理:",
      "  dave audit <command>         审计（公开入口 exit 2）",
      "",
      "记忆（默认开启，全自动）:",
      "  作用: 自动记录对话、整理项目约定、下一轮/新会话自动注入",
      "  dave brain status            查看开关、自动流程、路径与后端健康",
      "  dave brain enable|disable    打开或关闭记忆（关闭后不再落盘/注入）",
      "  dave brain add|search        手动写入/搜索长期记忆",
      "  dave brain sessions|organize 查看会话日志 / 手动整理成项目记忆",
      "  dave brain inject-preview    预览下一轮会注入模型的记忆块",
      "  dave brain provider […]      切换后端 local-json | engram | khoj",
      "  dave brain guide             用人话看完整工作流说明",
      "",
      "分阶段实验:",
      "  dave evolve <command>        自进化实验命令（exit 2）",
      "",
      "安装渠道（尚未冻结）:",
      "  dave upgrade / uninstall     拒绝：尚未形成 Dave 自有安装渠道",
      "  Windows 便携包卸载           %LOCALAPPDATA%\\Dave\\cli\\uninstall.ps1",
      "  勿对 Dave.exe 直接 upgrade   PE 内是上游安装渠道，会破坏便携安装语义",
      "",
      "顶层选项:",
      "  --help, -h                   显示帮助（产品面，非上游全量命令表）",
      "  --version, -v                显示版本号（优先读安装包 meta）",
      "  --yolo                       危险：全屏 TUI + 自动批准工具/命令",
      "  --dangerously-skip-permissions  等同 --yolo",
      "  --mini                       可选轻量 UI；默认仍是全屏",
      "",
      "状态路径（双 home，有意设计）:",
      "  config / policy / audit      ~/.dave/  (Dave product home)",
      "  goals / calendar / memory    ~/.atomcode/  (shared agent state)",
      "  config                       ~/.dave/dave.json (preferred)",
      "  skills policy                ~/.dave/skills.json (optional enable/disable/override)",
      "  stable audit log             ~/.dave/audit/stable.jsonl (goal/cal mutations)",
      "  runtime audit log            ~/.dave/audit/runtime.jsonl (advanced permission decisions)",
      "  goals                        ~/.atomcode/goals/{goals.json,GOALS.md}",
      "  calendar                     ~/.atomcode/calendar/{calendar.json,CALENDAR.md}",
      "  memory policy                ~/.dave/memory.json (default on; set enabled:false to disable)",
      "  memory notes                 ~/.atomcode/memory/{notes.json,NOTES.md,sessions/,projects/}",
      "",
    ].join("\n"),
  )
}

function showVersion() {
  // 开发态 src 跑时 InstallationVersion 常为 "local"；package:cli 虽 define 版本，
  // 但 core 包路径下有时仍落到 local。优先读旁路 meta，保证用户看到可追溯版本号。
  const root = packageRootDir()
  const candidates = [
    `${root}/app/dave-package-meta.json`,
    `${root}/dave-package-meta.json`,
    `${root}/portable-meta.json`,
    `${root}/dist/dave-package-meta.json`,
    // 与 app/dave.js 同级（便携包 app/）
    pathFromUrl(new URL("./dave-package-meta.json", import.meta.url)),
  ]
  for (const candidate of candidates) {
    const hit = existsSync(candidate)
      ? candidate
      : existsSync(candidate.replaceAll("/", "\\"))
        ? candidate.replaceAll("/", "\\")
        : null
    if (!hit) continue
    try {
      const j = JSON.parse(readFileSync(hit, "utf8")) as { version?: string }
      if (j.version && String(j.version).trim()) {
        process.stdout.write(String(j.version).trim() + "\n")
        return
      }
    } catch {
      // next
    }
  }
  process.stdout.write(String(InstallationVersion) + "\n")
}

function rejectUnsupportedDangerousFlags(argv: string[]) {
  if (!hasFlag(argv, "--auto")) return false
  process.stderr.write(
    "dave --auto 不受支持。仅在你明确接受自动批准权限时使用 --yolo 或 --dangerously-skip-permissions。\n",
  )
  process.exit(2)
}

function pathFromUrl(url: URL) {
  return process.platform === "win32" ? decodeURIComponent(url.pathname.replace(/^\//, "")) : url.pathname
}

function packageRootDir() {
  // src/dave.ts / dist/dave.js → monorepo package root
  // 便携安装 app/dave.js → 安装根（%LOCALAPPDATA%\Dave\cli）
  const here = pathFromUrl(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")
  if (
    here.endsWith(`${"\\"}src`) ||
    here.endsWith("/src") ||
    here.endsWith(`${"\\"}dist`) ||
    here.endsWith("/dist") ||
    here.endsWith(`${"\\"}app`) ||
    here.endsWith("/app")
  ) {
    return here.replace(/[\\/](src|dist|app)$/, "")
  }
  return here
}

function opencodeEntryPath() {
  // Default: prebuilt dist (stable). Set DAVE_TUI_SRC=1 to run workspace source so
  // brand/theme UI polish from packages/tui applies without a full package rebuild.
  // When already running from src/*.ts (dev), prefer sibling index.ts unless dist exists and DAVE_TUI_SRC!=1.
  const root = packageRootDir()
  const srcIndex = pathFromUrl(new URL("./index.ts", import.meta.url))
  if (process.env.DAVE_TUI_SRC === "1" && existsSync(srcIndex)) return srcIndex
  // monorepo: <root>/dist/index.js；便携包: <root>/app/index.js（与 dave.js 同级）
  const distIndex = path.join(root, "dist", "index.js")
  if (existsSync(distIndex)) return distIndex
  const appIndex = path.join(root, "app", "index.js")
  if (existsSync(appIndex)) return appIndex
  const siblingDist = pathFromUrl(new URL("./index.js", import.meta.url))
  if (existsSync(siblingDist)) return siblingDist
  // Dev: src/dave.ts → src/index.ts (no package:cli dist yet)
  if (existsSync(srcIndex)) return srcIndex
  return srcIndex
}

async function runDaveCommand(argv: string[]) {
  await yargs(argv)
    .parserConfiguration({ "populate--": true })
    .scriptName("dave")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", InstallationVersion)
    .alias("version", "v")
    .command(DoctorCommand)
    .command(DaveStatusCommand)
    .command(GoalCommand)
    .command(CalendarCommand)
    .command(BrainCommand)
    .demandCommand(1, "run 'dave status' to see Dave CLI stable status")
    .strict()
    .parseAsync()
}

function resolveBunExecutable() {
  if (typeof process.versions?.bun === "string" && process.execPath) return process.execPath

  const isWin = process.platform === "win32"
  const bunExe = isWin ? "bun.exe" : "bun"
  const candidates: string[] = []

  if (process.env.BUN_INSTALL) candidates.push(`${process.env.BUN_INSTALL}/bin/${bunExe}`)
  if (process.env.HOME) candidates.push(`${process.env.HOME}/.bun/bin/${bunExe}`)
  if (process.env.USERPROFILE) candidates.push(`${process.env.USERPROFILE}/.bun/bin/${bunExe}`)

  const lookup = isWin
    ? spawnSync("where.exe", ["bun"], { encoding: "utf8", windowsHide: true })
    : spawnSync("sh", ["-lc", "command -v bun"], { encoding: "utf8" })

  if (lookup.status === 0 && lookup.stdout) {
    for (const line of lookup.stdout.split(/\r?\n/)) {
      const hit = line.trim()
      if (!hit) continue
      if (hit.toLowerCase().endsWith(bunExe) && existsSync(hit)) {
        candidates.push(hit)
        continue
      }
      const idx = hit.replaceAll("\\", "/").lastIndexOf("/")
      const dir = idx >= 0 ? hit.slice(0, idx) : "."
      candidates.push(`${dir}/node_modules/bun/bin/${bunExe}`)
    }
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return bunExe
}

type NativeProbeCache = {
  version: 1
  /** path -> { size, mtimeMs, isShell } */
  entries: Record<string, { size: number; mtimeMs: number; isShell: boolean }>
}

function nativeProbeCachePath() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_CACHE_HOME ||
    path.join(process.env.HOME || process.env.USERPROFILE || os.tmpdir(), ".cache")
  return path.join(base, "Dave", "cli", "native-agent-probe.json")
}

function readNativeProbeCache(): NativeProbeCache {
  try {
    const raw = JSON.parse(readFileSync(nativeProbeCachePath(), "utf8")) as NativeProbeCache
    if (raw?.version === 1 && raw.entries && typeof raw.entries === "object") return raw
  } catch {
    // miss
  }
  return { version: 1, entries: {} }
}

function writeNativeProbeCache(cache: NativeProbeCache) {
  try {
    const file = nativeProbeCachePath()
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(cache)}\n`, "utf8")
  } catch {
    // best-effort cache only
  }
}

function isDaveEntryShellBinary(hit: string): boolean {
  // 根因：历史 package 把「Dave 入口壳」编成 dist/dave.exe（体积也 >5MB），
  // 空 argv 只打印旧 help，不是 Agent TUI。
  // Cache by path+size+mtime so cold start does not re-spawn --help every time.
  let size = 0
  let mtimeMs = 0
  try {
    const st = statSync(hit)
    size = st.size
    mtimeMs = st.mtimeMs
  } catch {
    // statSync 失败（文件不存在/权限问题）不应误判为入口壳：让候选进入下一轮校验
    return false
  }
  const cache = readNativeProbeCache()
  const key = path.resolve(hit)
  const cached = cache.entries[key]
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    return cached.isShell
  }

  let isShell = false
  try {
    const probe = spawnSync(hit, ["--help"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, DAVE_SKIP_AUTH_PREFLIGHT: "1" },
    })
    // 探测超时（ETIMEDOUT/SIGTERM）不应误判为入口壳：让候选进入下一轮校验
    if (probe.error || probe.signal === "SIGTERM") {
      isShell = false
    } else {
      const text = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`
      // 旧/壳入口特征：只讲 stable commands / 没有 opentui 会话 UI
      if (/show this Dave command guide|Stable commands:|稳定命令:/.test(text) && !/opencode|OpenTUI|session/i.test(text)) {
        isShell = true
      } else if (/Module not found|B:\/~BUN\/root/i.test(text)) {
        // 损坏的 bun 单文件包常见报错
        isShell = true
      }
    }
  } catch {
    // spawnSync 抛错时不应误判为入口壳：让候选进入下一轮校验
    isShell = false
  }
  cache.entries[key] = { size, mtimeMs, isShell }
  // Cap cache growth
  const keys = Object.keys(cache.entries)
  if (keys.length > 40) {
    for (const k of keys.slice(0, keys.length - 40)) delete cache.entries[k]
  }
  writeNativeProbeCache(cache)
  return isShell
}

/**
 * Compiled all-in-one PE can host TUI in-process.
 * First principles:
 * - under `bun run src/dave.ts`, process.execPath is bun.exe — never treat as Dave PE
 * - product Dave.exe help text also contains「稳定命令」— that is NOT proof of entry-shell
 *   (entry-shell probe is for *other* PE candidates, not for self when already size-gated)
 */
function isSelfCompiledAgentBinary(): boolean {
  if (!process.versions.bun) return false
  if (
    !mayBeSelfCompiledAgent({
      execPath: process.execPath,
      argv: process.argv,
      forceBun: process.env.DAVE_FORCE_BUN === "1",
      tuiChild: process.env.DAVE_TUI_CHILD === "1",
    })
  ) {
    return false
  }
  try {
    const selfSize = statSync(process.execPath).size
    // Full agent images are large; small stubs are never self-agent.
    if (selfSize <= 50_000_000) return false
  } catch {
    return false
  }
  // Self PE: size + non-generic-bun is enough. Do NOT run isDaveEntryShellBinary on self —
  // product help intentionally looks like the old shell guide and would false-positive.
  return true
}

function debugNativeLog(message: string) {
  // Only when explicitly debugging native resolution — not on every DEBUG_MAP probe.
  if (process.env.DAVE_DEBUG_NATIVE === "1") {
    process.stderr.write(`dave: ${message}\n`)
  }
}

function resolveNativeAgentBinary() {
  // 一体化 Bun.compile exe 自身：内嵌 runtime + 模块图 → 进程内 import，避免 spawn 自身死循环
  if (isSelfCompiledAgentBinary()) return process.execPath

  // 默认优先 bun+index（上游/开发路径）。
  // 仅当真实 Agent PE 通过体积 + 内容探测时才走 native。
  if (process.env.DAVE_FORCE_BUN === "1") return null
  // Dev: `bun run src/dave.ts` must not pick stale monorepo PE (e.g. dist/opencode-windows-x64)
  // unless maintainer opts in with DAVE_PREFER_NATIVE=1 or DAVE_NATIVE_AGENT_BIN.
  if (
    preferBunRuntimeForDev({
      argv: process.argv,
      forceBun: process.env.DAVE_FORCE_BUN === "1",
      preferNative: process.env.DAVE_PREFER_NATIVE === "1",
      nativeAgentBin: process.env.DAVE_NATIVE_AGENT_BIN,
    })
  ) {
    debugNativeLog("dev source argv → prefer bun runtime (set DAVE_PREFER_NATIVE=1 to scan PE trees)")
    return null
  }

  const root = packageRootDir()
  const allowDaveExe = process.env.DAVE_ALLOW_DAVE_EXE_NATIVE === "1"
  const skipProbe =
    process.env.DAVE_SKIP_NATIVE_PROBE === "1" && allowDevBypass("DAVE_SKIP_NATIVE_PROBE")
  // DAVE_NATIVE_AGENT_BIN is an explicit maintainer override — must still pass size + content probe
  // unless DAVE_SKIP_NATIVE_PROBE=1. Never treat env path as automatically trusted.
  const candidates = nativeAgentCandidates(root, {
    allowDaveExe,
    overrideBin: process.env.DAVE_NATIVE_AGENT_BIN,
  })

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const size = statSync(candidate).size
      if (size <= 5_000_000) {
        debugNativeLog(`忽略 native 桩二进制（${size} bytes）: ${candidate}`)
        continue
      }
      if (!skipProbe && isDaveEntryShellBinary(candidate)) {
        debugNativeLog(`忽略 Dave 入口壳 PE（不是 Agent TUI）: ${candidate}`)
        continue
      }
      return candidate
    } catch {
      // next
    }
  }
  return null
}

/** Shared child env: pure plugin surface + brand. Never shadow without these defaults. */
function agentChildEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENCODE_PURE: process.env.OPENCODE_PURE ?? "1",
    OPENCODE_FAST_BOOT: process.env.OPENCODE_FAST_BOOT ?? "1",
    DAVE_CLI_NAME: process.env.DAVE_CLI_NAME ?? "dave",
    ...extra,
  }
}

function writeDaveBanner(kind: "native" | "bun" | "native-in-process", target: string) {
  if (process.env.DAVE_QUIET === "1") return
  const short = target.length > 52 ? `…${target.slice(-51)}` : target
  const mini = hasFlag(args, "--mini")
  // Plain lines only — avoid CJK/box-drawing width math that breaks padEnd borders.
  process.stderr.write(
    [
      "dave ──────────────────────────────────────────────",
      mini
        ? "  戴夫编程 Agent UI · 轻量 UI (--mini)（非 skills）"
        : "  戴夫编程 Agent UI · 全屏 TUI（默认）",
      "  stable: doctor / status / goal / cal",
      "  memory: dave brain status   danger: --yolo",
      `  runtime: ${kind}  ${short}`,
      "  提示: 权限模式显示在 agent 名旁（ask | AUTO）",
      "────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  )
}

function warnAdvancedRuntimeEntry(argv: string[]) {
  if (process.env.DAVE_QUIET === "1") return
  const dangerous = hasFlag(argv, "--yolo", "--dangerously-skip-permissions")
  const mini = hasFlag(argv, "--mini")
  process.stderr.write(
    [
      "dave: 进入高级 Agent 运行时（非稳定 Dave CLI 面）。",
      mini
        ? "dave: UI 模式 = 轻量 (--mini)。未加 --mini 时默认全屏 TUI。"
        : "dave: UI 模式 = 全屏 TUI（默认）。仅在需要轻量 UI 时传 --mini。",
      dangerous
        ? "dave: 危险 — --yolo 将自动批准权限；工具可能改文件并执行命令。"
        : "dave: 权限模式初始为 ask（会询问）。可在命令面板 → permission.mode 切换。",
      "dave: 稳定面仍仅为 doctor / status / goal / cal。",
      "dave: 这是编程 Agent 路径（不是 brain 帮助，也不是 skills CLI）。",
      "",
    ].join("\n"),
  )
}

function rejectFrozenChannelCommand(command: string) {
  process.stderr.write(
    [
      `dave ${command} 尚未纳入 Dave 公开安装渠道。`,
      "在确认 npm scope 权属前，公开 install / upgrade / uninstall 保持冻结。",
      "此命令被刻意拦截：上游 runtime 会升级/卸载上游包，而不是 @dave-ai/cli。",
      "维护者流程见 docs/INSTALL_UPGRADE_UNINSTALL.md 与 docs/RELEASE_OWNERSHIP.md。",
      "稳定面仍为: doctor, status, goal, cal。",
      "",
    ].join("\n"),
  )
  process.exit(2)
}

function rejectUnknownCommand(command: string) {
  process.stderr.write(
    [
      `dave: 未知命令 '${command}'。`,
      "稳定命令: doctor, status, goal, cal。",
      "编程 Agent UI（显式入口）: dave | dave tui | dave --yolo | dave web | dave run \"prompt\"",
      "记忆: dave brain status（不是写代码 UI）",
      "Skills / 商店不在稳定产品面。",
      "",
    ].join("\n"),
  )
  process.exit(2)
}

/** Run interactive agent with signal forwarding so Ctrl+C cleans up the child. */
function runInteractiveAgent(cmd: string, cmdArgs: string[], env: NodeJS.ProcessEnv): Promise<number> {
  // ponytail: Windows Terminal (WT) kills opentui native TUI tabs; re-launch under conhost.
  // Args are escaped for cmd.exe (see dave-win-cmd) — never raw-join user strings.
  if (process.platform === "win32" && process.env.WT_SESSION && !process.env.DAVE_NO_CONHOST) {
    process.stderr.write(
      [
        "dave: Windows Terminal（WT_SESSION）与全屏 opentui TUI 不兼容。",
        "dave: 正在用 conhost.exe 新开窗口启动 Agent UI。",
        "dave: 当前 WT 标签页会立即退出；请到新控制台窗口继续。",
        "dave: 若要强制留在 WT（不受支持）: set DAVE_NO_CONHOST=1",
        "",
      ].join("\n"),
    )
    // cmd `set` only for whitelisted keys/values (see cmdSetAssignment) — never raw env interpolation.
    const envSets = [
      ...cmdSetAssignmentsFromEnv({ ...env, DAVE_NO_CONHOST: "1" }, [
        "OPENCODE_PURE",
        "OPENCODE_FAST_BOOT",
        "DAVE_TUI_CHILD",
        "DAVE_NO_CONHOST",
        "OPENCODE_SHOW_TTFD",
        "DAVE_SHOW_TTFD",
      ]),
    ]
    if (!envSets.some((s) => s.startsWith("set DAVE_NO_CONHOST="))) {
      envSets.push("set DAVE_NO_CONHOST=1")
    }
    return new Promise((resolve) => {
      let settled = false
      const done = (code: number) => {
        if (settled) return
        settled = true
        resolve(code)
      }
      const child = spawn(
        "conhost.exe",
        conhostCmdArgs(cmd, cmdArgs, envSets),
        {
          stdio: "ignore",
          windowsHide: false,
          env: { ...env, DAVE_NO_CONHOST: "1" },
          detached: true,
        },
      )
      child.unref()
      // 等待 spawn 确认后再 resolve，避免启动失败被 exit 0 掩盖
      child.on("spawn", () => done(0))
      child.on("error", (err) => {
        process.stderr.write(`dave: conhost 重启动失败: ${err.message}\n`)
        done(1)
      })
      // 兜底：500ms 内若 spawn 事件未触发，假定成功（conhost 是系统进程）
      setTimeout(() => done(0), 500).unref?.()
    })
  }
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(cmd, cmdArgs, {
      stdio: "inherit",
      windowsHide: false,
      env,
    })

    let settled = false
    const finish = (code: number) => {
      if (settled) return
      settled = true
      process.removeListener("SIGINT", onSig)
      process.removeListener("SIGTERM", onSig)
      resolve(code)
    }

    const onSig = () => {
      try {
        if (!child.killed) child.kill()
      } catch {
        // ignore
      }
      // Ensure parent exits if child ignores signal on Windows.
      setTimeout(() => finish(130), 1500).unref?.()
    }

    process.on("SIGINT", onSig)
    process.on("SIGTERM", onSig)

    child.on("error", (err) => {
      process.stderr.write(`dave: 进程启动失败: ${err.message}\n`)
      finish(1)
    })
    child.on("exit", (code, signal) => {
      if (signal) finish(signal === "SIGINT" ? 130 : 1)
      else finish(typeof code === "number" ? code : 1)
    })
  })
}

function isInteractiveTty() {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY)
}

/** 无子命令时：交互 TTY 默认进 TUI；管道/脚本仍打印 help。可用 DAVE_BARE_HELP=1 强制 help。 */
function resolveBareArgv(argv: string[]): string[] {
  return resolveBareDaveArgv(argv, {
    isInteractiveTty: isInteractiveTty(),
    bareHelp: process.env.DAVE_BARE_HELP === "1",
  })
}

function allowDevBypass(flagName: string): boolean {
  // Prefer compile-time InstallationChannel when env OPENCODE_CHANNEL is unset.
  return allowDevBypassFlag(flagName, String(InstallationVersion), String(InstallationChannel))
}

async function ensureAdvancedAuthOrExit(argv: string[]) {
  if (process.env.DAVE_SKIP_AUTH_PREFLIGHT === "1") {
    if (!allowDevBypass("DAVE_SKIP_AUTH_PREFLIGHT")) {
      // fall through to real preflight
    } else {
      process.stderr.write("dave: 已跳过鉴权预检 (DAVE_SKIP_AUTH_PREFLIGHT=1) — 仅调试/测试用途\n")
      return
    }
  }
  // 仅 interactive agent / run 需要模型；web/serve 等可跳过重探测
  const command = firstNonFlag(
    argv.filter((a) => a !== "--yolo" && a !== "--dangerously-skip-permissions" && a !== "--mini"),
  )
  const needsModel =
    hasFlag(argv, "--yolo", "--dangerously-skip-permissions", "--mini") ||
    command === "tui" ||
    command === "run" ||
    command === "attach" ||
    isBareAgentUiArgv(argv) ||
    (!command && isInteractiveTty())
  if (!needsModel) return

  const result = await preflightDefaultProvider()
  if (result.ok) {
    if (process.env.DAVE_QUIET !== "1") {
      process.stderr.write(`dave: auth preflight OK — ${result.providerID}/${result.modelID}\n`)
    }
    return
  }
  process.stderr.write(formatPreflightFailure(result))
  process.exit(2)
}

async function main() {
  const resolvedArgs = resolveBareArgv(args)
  const command = firstNonFlag(resolvedArgs)

  if (!command && hasFlag(resolvedArgs, "--help", "-h")) {
    showHelp()
    process.exit(0)
  }

  if (!command && hasFlag(resolvedArgs, "--version", "-v")) {
    showVersion()
    process.exit(0)
  }

  if (rejectUnsupportedDangerousFlags(resolvedArgs)) {
    process.exit(process.exitCode ?? 2)
  }

  // Bare help path: no subcommand and not an advanced UI flag entry.
  // First principles: product help vs agent UI is decided by intent flags, not by "has tui token".
  if (!command && !isBareAgentUiArgv(resolvedArgs)) {
    showHelp()
    process.exit(0)
  }

  if (command && STABLE_COMMANDS.has(command)) {
    await runDaveCommand(resolvedArgs)
    process.exit(process.exitCode ?? 0)
  }

  if (command && INTERNAL_COMMANDS.has(command)) {
    process.stderr.write(`dave ${command} 属于内部治理，尚未纳入稳定 Dave CLI 契约。\n`)
    process.exit(2)
  }

  if (command && MEMORY_COMMANDS.has(command)) {
    // brain: default-on local memory workflow (manual disable only).
    await runDaveCommand(resolvedArgs)
    process.exit(process.exitCode ?? 0)
  }

  if (command && STAGED_COMMANDS.has(command)) {
    process.stderr.write(`dave ${command} 属于分阶段实验，尚未纳入稳定 Dave CLI 契约。\n`)
    process.exit(2)
  }

  if (command && FROZEN_CHANNEL_COMMANDS.has(command)) {
    rejectFrozenChannelCommand(command)
    process.exit(process.exitCode ?? 2)
  }

  const advanced =
    isBareAgentUiArgv(resolvedArgs) ||
    hasFlag(resolvedArgs, "--yolo", "--dangerously-skip-permissions", "--mini") ||
    (command ? ADVANCED_COMMANDS.has(command) : false)

  if (!advanced) {
    rejectUnknownCommand(command ?? "<empty>")
    process.exit(process.exitCode ?? 2)
  }

  // DEBUG_MAP is a pure routing probe — skip banner noise and auth preflight side effects.
  const debugMap = process.env.DAVE_DEBUG_MAP === "1"
  if (!debugMap) warnAdvancedRuntimeEntry(resolvedArgs)
  const forwarded = mapDaveArgsToOpencode(resolvedArgs)
  const interactive = isInteractiveAgentArgv(resolvedArgs, forwarded)
  // Interactive Agent UI: verified native PE only; otherwise bun+index (supported).
  const native = interactive ? resolveNativeAgentBinary() : null
  const bunEntry = opencodeEntryPath()
  if (debugMap) {
    process.stderr.write(`dave: map -> ${JSON.stringify(forwarded)}\n`)
    process.stderr.write(`dave: entry -> ${native ?? bunEntry}\n`)
    process.stderr.write(`dave: runtime -> ${native ? "native" : "bun"}\n`)
    process.stderr.write(`dave: mode -> ${describeMapMode(forwarded)}\n`)
    process.exit(0)
  }

  // 真实启动 advanced 前：预检默认模型密钥，避免 TUI 打开后才报 Unauthorized
  await ensureAdvancedAuthOrExit(resolvedArgs)

  const childEnv = agentChildEnv()

  if (interactive && native) {
    // 一体化 exe 自身：native === process.execPath
    // 子进程模式（DAVE_TUI_CHILD=1）：conhost 已新开干净 TTY，直接进程内 import 跑 TUI
    // 父进程模式：spawn exe 自身 + DAVE_TUI_CHILD=1 让子进程走进程内 import（避免死循环 + 干净 TTY）
    if (path.resolve(native) === path.resolve(process.execPath)) {
      if (process.env.DAVE_TUI_CHILD === "1") {
        writeDaveBanner("native-in-process", native)
        if (process.env.DAVE_QUIET !== "1") {
          process.stderr.write(`dave: 一体化进程内 Agent UI（子进程干净 TTY）\n`)
        }
        try {
          const { runCli } = await import("./index.ts")
          await runCli(forwarded)
          process.exit(process.exitCode ?? 0)
        } catch (e) {
          const dump = e instanceof Error ? e : Object(e)
          const stack = dump.stack || ""
          const cause = dump.cause ? `\ncause: ${dump.cause instanceof Error ? dump.cause.stack || dump.cause.message : JSON.stringify(dump.cause)}` : ""
          const tag = dump._tag ? `\n_tag: ${dump._tag}` : ""
          process.stderr.write(`dave: 进程内 Agent UI 异常: ${dump.message || String(e)}${tag}${cause}\n${stack}\n`)
          process.exit(1)
        }
      }
      // 父进程：spawn 自身 + DAVE_TUI_CHILD=1。env 必须走 agentChildEnv（OPENCODE_PURE 等）。
      writeDaveBanner("native", native)
      const selfEnv = agentChildEnv({ DAVE_TUI_CHILD: "1" })
      if (process.env.WT_SESSION && !process.env.DAVE_NO_CONHOST) {
        process.stderr.write(
          [
            "dave: Windows Terminal 与全屏 TUI 不兼容，conhost 新开窗口启动。",
            "dave: 当前标签页会立即退出，请到新控制台窗口继续。",
            "",
          ].join("\n"),
        )
        // Reuse runInteractiveAgent conhost path with pure env preserved.
        const code = await runInteractiveAgent(process.execPath, forwarded, selfEnv)
        process.exit(code)
      }
      if (process.env.DAVE_QUIET !== "1") {
        process.stderr.write(`dave: 启动 TUI 子进程（干净 TTY）\n`)
      }
      const code = await runInteractiveAgent(process.execPath, forwarded, selfEnv)
      process.exit(code === 0 || code === 130 ? code : code || 1)
    }
    writeDaveBanner("native", native)
    if (process.env.DAVE_QUIET !== "1") {
      process.stderr.write(`dave: 使用已验证 native Agent UI 二进制\n`)
      process.stderr.write(`dave: 全屏终端 TUI（仅当需要轻量 UI 时再传 --mini）\n`)
    }
    const code = await runInteractiveAgent(native, forwarded, childEnv)
    if (code === 0 || code === 130) process.exit(code)
    process.stderr.write(
      [
        "dave: native Agent UI 异常退出。",
        "提示: 设置 DAVE_FORCE_BUN=1 强制 bun+dist/index.js，或通过 DAVE_NATIVE_AGENT_BIN 指定已验证 Agent PE。",
        "",
      ].join("\n"),
    )
    process.exit(code || 1)
  }

  if (interactive && process.platform === "win32" && !native && process.env.DAVE_QUIET !== "1") {
    process.stderr.write(
      "dave: Agent TUI 使用 bun+index（无已验证 native Agent PE；开发默认 / 已忽略入口壳）。\n",
    )
  }

  const bunCmd = resolveBunExecutable()
  const bunArgs = ["run", "--conditions=browser", bunEntry, ...forwarded]

  if (interactive) {
    writeDaveBanner("bun", bunEntry)
    const code = await runInteractiveAgent(bunCmd, bunArgs, childEnv)
    if (code === 0 || code === 130) process.exit(code)
    process.stderr.write(
      [
        "dave: 编程 Agent UI 启动失败。",
        "Windows 常见原因:",
        "  - 没有真实 TTY（不要重定向 stdout；请用真实控制台）",
        "  - dist/ 缺少 opentui-*.dll / tree-sitter / highlights 资源（重新 package:cli）",
        "  - 若报 opentui is not supported on win32-x64：多半是资源路径仍相对 cwd，请更新 package:cli 后重建 dist",
        "  - bun+dist/index.js 是支持的 Agent TUI 路径（native PE 仅在探测通过后可选）",
        "",
      ].join("\n"),
    )
    process.exit(code || 1)
  }

  // Non-interactive advanced (run/serve/web/mcp/...): sync spawn is fine.
  const child = spawnSync(bunCmd, bunArgs, {
    stdio: "inherit",
    windowsHide: true,
    env: childEnv,
  })
  process.exit(typeof child.status === "number" ? child.status : 1)
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : `${String(error)}\n`)
  process.exit(1)
})
