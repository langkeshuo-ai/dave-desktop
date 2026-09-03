/* =========================================================================
   本地诊断导出(roadmap §3.2):一键打包"系统信息 + 会话元数据 + 应用日志 +
   结构化事件日志"为单个文本文件,方便用户贴给开发者排障。

   纯函数部分(formatSystemInfo / formatSessionSummary)node 环境可单测。
   ========================================================================= */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import { getSessionList, getSessionMessages } from "./session"

export interface SystemInfoInput {
  platform: NodeJS.Platform
  arch: string
  appVersion: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  totalMemoryMB: number
  userData: string
}

/** 格式化系统信息(纯函数,可单测)。 */
export function formatSystemInfo(info: SystemInfoInput): string {
  return [
    "== 系统信息 ==",
    `平台: ${info.platform} (${info.arch})`,
    `应用版本: ${info.appVersion}`,
    `Electron: ${info.electronVersion}`,
    `Node: ${info.nodeVersion}`,
    `Chromium: ${info.chromeVersion}`,
    `内存: ${info.totalMemoryMB} MB`,
    `用户数据目录: ${info.userData}`,
  ].join("\n")
}

interface SessionMeta {
  id: string
  title: string
  updatedAt: number
}

/** 会话元数据统计(纯函数,可单测;messageCounts 注入避免依赖 store)。 */
export function formatSessionSummary(
  sessions: SessionMeta[],
  messageCounts: (id: string) => number,
): string {
  return [
    "== 会话元数据 ==",
    `会话数: ${sessions.length}`,
    ...sessions.map(
      (s) =>
        `- ${s.title} (${messageCounts(s.id)} 条消息, 更新 ${new Date(s.updatedAt).toISOString()})`,
    ),
  ].join("\n")
}

/** 导出诊断报告,返回文件路径(失败返回 null)。 */
export function exportDiagnostics(): string | null {
  try {
    const userData = app.getPath("userData")
    const lines: string[] = [
      "Dave Desktop 诊断报告",
      `生成时间: ${new Date().toISOString()}`,
      "",
      formatSystemInfo({
        platform: process.platform,
        arch: process.arch,
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? "unknown",
        nodeVersion: process.versions.node,
        chromeVersion: (process.versions as { chrome?: string }).chrome ?? "unknown",
        totalMemoryMB: process.getSystemMemoryInfo
          ? Math.round(process.getSystemMemoryInfo().total / 1024 / 1024)
          : 0,
        userData,
      }),
      "",
      formatSessionSummary(getSessionList(), (id) => getSessionMessages(id).length),
    ]

    // 文本日志(electron-log,最多取末尾 200KB)
    const logPath = join(userData, "dave-desktop.log")
    if (existsSync(logPath)) {
      lines.push(
        "",
        "== 应用日志(dave-desktop.log) ==",
        readFileSync(logPath, "utf8").slice(-200_000),
      )
    }

    // 结构化事件日志
    const eventsPath = join(userData, "logs", "events.jsonl")
    if (existsSync(eventsPath)) {
      lines.push("", "== 结构化事件日志(events.jsonl) ==", readFileSync(eventsPath, "utf8"))
    }

    const outDir = join(userData, "diagnostics")
    mkdirSync(outDir, { recursive: true })
    const outPath = join(outDir, `dave-diagnostics-${Date.now()}.txt`)
    writeFileSync(outPath, lines.join("\n"), "utf8")
    return outPath
  } catch {
    // 诊断导出失败不打断主流程
    return null
  }
}
