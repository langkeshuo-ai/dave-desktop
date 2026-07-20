/* =========================================================================
   Dave Desktop — Agent toolset
   =========================================================================
   Patch: npm `diff` (BSD-3-Clause) via shared/patch.ts
   Shell: npm `execa` (MIT) async, non-blocking main process
   Search: host ast-grep / rg / grep via execa without shell when possible
   ========================================================================= */

import { readFile, writeFile, mkdir, readdir, stat, rm, realpath } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve, isAbsolute, relative, dirname, sep } from "node:path"
import { execa } from "execa"
import log from "electron-log"
import { parseUnifiedPatch, applyPatchToText } from "../shared/patch"
import { clampToolOutput } from "../shared/context"
import { deniedShellReason, isElevatedShellRisk } from "../shared/shell-policy"
import { MAX_READ_FILE_CHARS } from "../shared/types"
import type { AgentMode } from "../shared/types"
import type { FileTreeNode } from "../shared/workspace"

export type { AgentMode }

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  name: string
  ok: boolean
  output: string
  /** Patch payload — when name === "propose_patch" or write proposes diff. */
  patch?: string
  paths?: string[]
}

/* ----------------------------------------------------------------------- */
/* Workspace guard                                                          */
/* ----------------------------------------------------------------------- */

export async function assertInWorkspace(workspace: string, target: string): Promise<string> {
  if (!workspace) throw new Error("工作区未配置 — 请在设置中选择工作区目录")
  const abs = isAbsolute(target) ? target : resolve(workspace, target)
  let rootReal = workspace
  let absReal = abs
  try {
    if (existsSync(workspace)) rootReal = await realpath(workspace)
  } catch {
    /* keep workspace */
  }
  try {
    if (existsSync(abs)) absReal = await realpath(abs)
    else {
      // Parent may exist — resolve parent + basename to catch symlink parents.
      const parent = dirname(abs)
      if (existsSync(parent)) {
        absReal = join(await realpath(parent), abs.slice(parent.length).replace(/^[\\/]/, ""))
      }
    }
  } catch {
    /* keep abs */
  }
  const rel = relative(rootReal, absReal)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`路径越界：${target} 不在工作区内（工作区=${workspace}）`)
  }
  // Normalize separators for Windows consistency
  return absReal.includes(sep) ? absReal : abs
}

/* ----------------------------------------------------------------------- */
/* read_file                                                                */
/* ----------------------------------------------------------------------- */

async function toolReadFile(workspace: string, args: { path: string }): Promise<ToolResult> {
  const abs = await assertInWorkspace(workspace, args.path)
  let content = await readFile(abs, "utf8")
  if (content.length > MAX_READ_FILE_CHARS) {
    content =
      content.slice(0, MAX_READ_FILE_CHARS) +
      `\n\n…[文件过大，已截断至 ${MAX_READ_FILE_CHARS} 字符 / 共 ${content.length}]`
  }
  const lines = content.split("\n").length
  return {
    name: "read_file",
    ok: true,
    output: clampToolOutput(`${abs} (${lines} 行)\n\n${content}`),
    paths: [abs],
  }
}

/* ----------------------------------------------------------------------- */
/* write_file                                                               */
/* ----------------------------------------------------------------------- */

async function toolWriteFile(
  workspace: string,
  args: { path: string; content: string },
): Promise<ToolResult> {
  const abs = await assertInWorkspace(workspace, args.path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, args.content, "utf8")
  return {
    name: "write_file",
    ok: true,
    output: `已写入 ${abs} (${args.content.length} 字符)`,
    paths: [abs],
  }
}

/* ----------------------------------------------------------------------- */
/* patch — propose + apply (diff package)                                   */
/* ----------------------------------------------------------------------- */

async function toolProposePatch(workspace: string, args: { diff: string }): Promise<ToolResult> {
  const files = parseUnifiedPatch(args.diff)
  // Validate each path is in workspace (no apply yet).
  for (const f of files) {
    await assertInWorkspace(workspace, f.path)
  }
  return {
    name: "propose_patch",
    ok: true,
    output: `已解析 ${files.length} 个文件的 patch — 待批准`,
    patch: args.diff,
    paths: files.map((f) => f.path),
  }
}

async function toolApplyPatch(workspace: string, args: { diff: string }): Promise<ToolResult> {
  const files = parseUnifiedPatch(args.diff)
  const touched: string[] = []
  for (const f of files) {
    const abs = await assertInWorkspace(workspace, f.path)
    const isNew = !existsSync(abs)
    if (isNew) {
      await mkdir(dirname(abs), { recursive: true })
      const applied = applyPatchToText("", f.structured)
      await writeFile(abs, applied, "utf8")
    } else {
      const original = await readFile(abs, "utf8")
      const applied = applyPatchToText(original, f.structured)
      await writeFile(abs, applied, "utf8")
    }
    touched.push(abs)
  }
  return {
    name: "apply_patch",
    ok: true,
    output: `已应用 ${touched.length} 个文件\n${touched.join("\n")}`,
    // Surface the same diff so renderer can show what was applied.
    patch: args.diff,
    paths: touched,
  }
}

/* ----------------------------------------------------------------------- */
/* shell — async via execa                                                  */
/* ----------------------------------------------------------------------- */

async function toolShell(
  workspace: string,
  args: { command: string; cwd?: string },
): Promise<ToolResult> {
  const cwd = args.cwd ? await assertInWorkspace(workspace, args.cwd) : workspace
  const cmd = (args.command || "").trim()
  const denied = deniedShellReason(cmd)
  if (denied) throw new Error(denied)
  try {
    const result = await execa(cmd, {
      cwd,
      shell: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      reject: false,
      all: true,
    })
    const out = (result.all || result.stdout || "").toString()
    if (result.failed) {
      return {
        name: "shell",
        ok: false,
        output: clampToolOutput(
          `命令失败 (exit ${result.exitCode ?? "?"}):\n${out || result.stderr || result.shortMessage}`,
        ),
      }
    }
    return {
      name: "shell",
      ok: true,
      output: clampToolOutput(out || "(命令完成，无输出)"),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { name: "shell", ok: false, output: clampToolOutput(`命令失败: ${msg}`) }
  }
}

/* ----------------------------------------------------------------------- */
/* ast_grep — host binary via execa (no shell string when possible)         */
/* ----------------------------------------------------------------------- */

async function toolAstGrep(
  workspace: string,
  args: { pattern: string; lang?: string; paths?: string[] },
): Promise<ToolResult> {
  const searchPaths = await Promise.all(
    (args.paths ?? ["."]).map((p) => assertInWorkspace(workspace, p)),
  )
  const relPaths = searchPaths.map((p) => relative(workspace, p) || ".")

  // Prefer ast-grep argv form
  try {
    const asgArgs = ["run", "--json", args.pattern]
    if (args.lang) asgArgs.push("--lang", args.lang)
    asgArgs.push(...relPaths)
    const result = await execa("ast-grep", asgArgs, {
      cwd: workspace,
      timeout: 15_000,
      reject: false,
      windowsHide: true,
    })
    if (!result.failed || result.stdout) {
      return {
        name: "ast_grep",
        ok: true,
        output: clampToolOutput(result.stdout || "(无匹配)"),
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const rgArgs = ["--json", "-e", args.pattern, ...relPaths]
    const result = await execa("rg", rgArgs, {
      cwd: workspace,
      timeout: 15_000,
      reject: false,
      windowsHide: true,
    })
    if (!result.failed || result.stdout) {
      return {
        name: "ast_grep",
        ok: true,
        output: clampToolOutput(`rg 兜底:\n${result.stdout || "(无匹配)"}`),
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const gpArgs = ["-rn", "--", args.pattern, ...relPaths]
    const result = await execa("grep", gpArgs, {
      cwd: workspace,
      timeout: 15_000,
      reject: false,
      windowsHide: true,
    })
    return {
      name: "ast_grep",
      ok: result.exitCode === 0 || result.exitCode === 1,
      output: clampToolOutput(`grep 兜底:\n${result.stdout || "(无匹配)"}`),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      name: "ast_grep",
      ok: false,
      output: `ast-grep / rg / grep 均失败：${msg}`,
    }
  }
}

/* ----------------------------------------------------------------------- */
/* file_tree                                                                */
/* ----------------------------------------------------------------------- */

export async function toolFileTree(
  workspace: string,
  args: { depth?: number },
): Promise<ToolResult> {
  const depth = args.depth ?? 3
  async function walk(dir: string, d: number): Promise<FileTreeNode[]> {
    if (d <= 0) return []
    const entries = await readdir(dir, { withFileTypes: true })
    const nodes: FileTreeNode[] = []
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "target" || e.name === "dist" || e.name === "out")
        continue
      const p = join(dir, e.name)
      const isDir = e.isDirectory()
      const node: FileTreeNode = { path: relative(workspace, p) || ".", name: e.name, isDir }
      if (isDir) {
        node.children = await walk(p, d - 1)
      } else {
        try {
          node.size = (await stat(p)).size
        } catch {
          /* race */
        }
      }
      nodes.push(node)
    }
    nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    return nodes
  }
  const tree = await walk(workspace, depth)
  return {
    name: "file_tree",
    ok: true,
    output: JSON.stringify(tree),
    paths: [workspace],
  }
}

/* ----------------------------------------------------------------------- */
/* list_files / remove                                                      */
/* ----------------------------------------------------------------------- */

async function toolListFiles(workspace: string, args: { path?: string }): Promise<ToolResult> {
  const dir = args.path ? await assertInWorkspace(workspace, args.path) : workspace
  const entries = await readdir(dir, { withFileTypes: true })
  const lines = entries.map((e) => `${e.isDirectory() ? "D" : "F"}  ${e.name}`)
  return {
    name: "list_files",
    ok: true,
    output: `${dir}\n${lines.join("\n")}`,
    paths: [dir],
  }
}

async function toolRemove(workspace: string, args: { path: string }): Promise<ToolResult> {
  const abs = await assertInWorkspace(workspace, args.path)
  let rootReal = workspace
  try {
    rootReal = await realpath(workspace)
  } catch {
    /* keep */
  }
  if (abs === workspace || abs === rootReal) throw new Error("拒绝删除工作区根")
  await rm(abs, { recursive: true, force: false })
  return {
    name: "remove",
    ok: true,
    output: `已删除 ${abs}`,
    paths: [abs],
  }
}

/* ----------------------------------------------------------------------- */
/* Tool registry                                                            */
/* ----------------------------------------------------------------------- */

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  mutates: boolean
  isShell: boolean
  run: (workspace: string, args: Record<string, unknown>, mode: AgentMode) => Promise<ToolResult>
}

export const TOOLS: ToolSpec[] = [
  {
    name: "read_file",
    description: "读取工作区内文件内容。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "工作区相对路径" } },
      required: ["path"],
    },
    mutates: false,
    isShell: false,
    run: (ws, args) => toolReadFile(ws, args as { path: string }),
  },
  {
    name: "list_files",
    description: "列出工作区内某目录的文件和子目录。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "工作区相对路径，默认根" } },
    },
    mutates: false,
    isShell: false,
    run: (ws, args) => toolListFiles(ws, args as { path?: string }),
  },
  {
    name: "write_file",
    description: "写入或覆盖文件。会自动创建父目录。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    mutates: true,
    isShell: false,
    run: (ws, args) => toolWriteFile(ws, args as { path: string; content: string }),
  },
  {
    name: "propose_patch",
    description:
      "解析 unified-diff 并展示给用户（不落地）。随后应用请调用 apply_patch 并使用同一 diff。",
    parameters: {
      type: "object",
      properties: { diff: { type: "string", description: "unified-diff（---/+++/@@）" } },
      required: ["diff"],
    },
    mutates: false,
    isShell: false,
    run: (ws, args) => toolProposePatch(ws, args as { diff: string }),
  },
  {
    name: "apply_patch",
    description: "应用 unified-diff。建议先 propose_patch 获用户批准后再调用。",
    parameters: {
      type: "object",
      properties: { diff: { type: "string" } },
      required: ["diff"],
    },
    mutates: true,
    isShell: false,
    run: (ws, args) => toolApplyPatch(ws, args as { diff: string }),
  },
  {
    name: "remove",
    description: "删除文件或目录（递归）。",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    mutates: true,
    isShell: false,
    run: (ws, args) => toolRemove(ws, args as { path: string }),
  },
  {
    name: "ast_grep",
    description: "用 AST grep 搜索代码结构 — 优先 ast-grep，自动兜底 rg / grep。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        lang: { type: "string", description: "语言，如 typescript / python / rust" },
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["pattern"],
    },
    mutates: false,
    isShell: true,
    run: (ws, args) =>
      toolAstGrep(ws, args as { pattern: string; lang?: string; paths?: string[] }),
  },
  {
    name: "shell",
    description: "在工作区内执行 shell 命令。30s 超时。拒绝危险模式。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "工作区相对路径，默认根" },
      },
      required: ["command"],
    },
    mutates: true,
    isShell: true,
    run: (ws, args) => toolShell(ws, args as { command: string; cwd?: string }),
  },
  {
    name: "file_tree",
    description: "返回工作区文件树（JSON）— 用于渲染层文件树面板。",
    parameters: {
      type: "object",
      properties: { depth: { type: "number", description: "深度，默认 3" } },
    },
    mutates: false,
    isShell: false,
    run: (ws, args) => toolFileTree(ws, args as { depth?: number }),
  },
]

export function getTool(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name)
}

/**
 * Approval matrix (Codex-style):
 * - ask: no tools advertised in loop; if called, no approval UI
 * - suggest: mutating + shell need OK
 * - auto: shell needs OK
 * - full-auto: normally none, EXCEPT elevated-risk shell still needs OK
 */
export function needsApproval(
  tool: ToolSpec,
  mode: AgentMode,
  args?: Record<string, unknown>,
): boolean {
  if (mode === "ask") return false
  if (mode === "suggest") return tool.mutates || tool.isShell
  if (mode === "auto") return tool.isShell
  if (mode === "full-auto") {
    if (tool.isShell) {
      const cmd = String(args?.command ?? "")
      return isElevatedShellRisk(cmd)
    }
    return false
  }
  return true
}

/** Apply a unified-diff inside the workspace (UI "应用" button). */
export async function applyWorkspaceDiff(
  workspace: string,
  diff: string,
): Promise<ToolResult> {
  return toolApplyPatch(workspace, { diff })
}

/**
 * Tool definitions advertised to the LLM.
 * file_tree is UI-only (workspace panel), not for the model.
 * propose_patch IS advertised so models can show diffs before apply.
 */
export function toolDefsFor(_provider: string): Record<string, unknown>[] {
  return TOOLS.filter((t) => t.name !== "file_tree").map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}
