import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { pathToFileURL } from "url"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { ConsoleCommand } from "./cli/cmd/account"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiThreadCommand, TuiCommand } from "./cli/cmd/tui"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plug"
import { Heap } from "./cli/heap"
import { DoctorCommand } from "./cli/cmd/doctor"
import { ScheduleCommand } from "./cli/cmd/schedule"
import { DaveCommand } from "./cli/cmd/dave"

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

/** 进程内调用入口：一体化 exe 避免 spawn 自身死循环。forwarded = 转发后的 opencode argv。 */
export async function runCli(forwarded: string[]) {
  const cli = yargs(forwarded)
    .parserConfiguration({ "populate--": true })
    .scriptName(process.env.DAVE_CLI_NAME || process.env.OPENCODE_CLI_NAME || "dave")
    .wrap(100)
    .help("help", "显示帮助")
    .alias("help", "h")
    .version("version", "显示版本号", InstallationVersion)
    .alias("version", "v")
    .option("print-logs", { describe: "将日志打印到 stderr", type: "boolean" })
    .option("log-level", {
      describe: "日志级别",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .option("pure", { describe: "不加载外部插件运行", type: "boolean" })
    .middleware(async (opts) => {
      if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
      if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
      if (opts.pure) process.env.OPENCODE_PURE = "1"
      Heap.start()
      process.env.AGENT = "1"
      process.env.OPENCODE = "1"
      process.env.OPENCODE_PID = String(process.pid)
    })
    .usage("")
    .completion("completion", "生成 shell 补全脚本")
    .command(AcpCommand)
    .command(McpCommand)
    .command(AttachCommand)
    .command(RunCommand)
    .command(GenerateCommand)
    .command(DebugCommand)
    .command(ConsoleCommand)
    .command(ProvidersCommand)
    .command(AgentCommand)
    .command(UpgradeCommand)
    .command(UninstallCommand)
    .command(ServeCommand)
    .command(WebCommand)
    .command(ModelsCommand)
    .command(StatsCommand)
    .command(ExportCommand)
    .command(ImportCommand)
    .command(GithubCommand)
    .command(PrCommand)
    .command(SessionCommand)
    .command(PluginCommand)
    .command(DoctorCommand)
    .command(ScheduleCommand)
    .command(DaveCommand)
    .command(DbCommand)
    .command(TuiCommand)
    .command(TuiThreadCommand)
    .fail((msg, err) => {
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:")
      ) {
        if (err) throw err
        cli.showHelp(show)
      }
      if (err) throw err
      process.exit(1)
    })
    .strict()

  if (forwarded.includes("-h") || forwarded.includes("--help")) {
    await cli.parse(forwarded, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
}

function isCliMainEntry() {
  // Bun: import.meta.main is reliable for `bun run ./src/index.ts`.
  if (typeof import.meta.main === "boolean" && import.meta.main) return true
  if (process.env.DAVE_CLI_ENTRY === "1") return true
  // Windows: import.meta.url is file:///C:/... while process.argv[1] is C:\... — strict === fails
  // and used to make dave spawn bun+index exit immediately with zero work (silent success).
  const arg = process.argv[1]
  if (!arg) return false
  try {
    if (import.meta.url === pathToFileURL(arg).href) return true
  } catch {
    // fall through
  }
  const urlPath = import.meta.url.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1")
  const a = decodeURIComponent(urlPath).replaceAll("\\", "/").toLowerCase()
  const b = arg.replaceAll("\\", "/").toLowerCase()
  return a === b || a.endsWith(b) || b.endsWith(a)
}

// 直接命令行运行（非一体化进程内调）时自动 parse
if (isCliMainEntry()) {
  const args = hideBin(process.argv)
  try {
    await runCli(args)
  } catch (e) {
    const formatted = FormatError(e)
    if (formatted) UI.error(formatted)
    if (formatted === undefined) {
      UI.error("Unexpected error" + EOL)
      process.stderr.write(errorMessage(e) + EOL)
    }
    process.exitCode = 1
  } finally {
    // Some subprocesses don't react properly to SIGTERM and similar signals.
    // Most notably, some docker-container-based MCP servers don't handle such signals unless
    // run using `docker run --init`.
    // Explicitly exit to avoid any hanging subprocesses — preserve exitCode set above/handlers.
    process.exit(process.exitCode ?? 0)
  }
}
