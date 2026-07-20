/* =========================================================================
   Shell command policy — pure rules, no Node process I/O.
   Used by agent toolShell and unit tests.
   ========================================================================= */

/** Patterns that must never run, even in full-auto. */
export const SHELL_DENY_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "rm -rf root/home", re: /\brm\s+-rf\s+[\/~]/i },
  { name: "fork bomb", re: /:\(\)\s*\{\s*:\|.*&.*\};/ },
  { name: "mkfs", re: /\bmkfs\b/i },
  { name: "dd if=", re: /\bdd\s+if=/i },
  { name: "format drive", re: /\bformat\s+[a-z]:/i },
  { name: "shutdown/reboot", re: /\b(shutdown|reboot|poweroff)\b/i },
  { name: "curl|sh / wget|sh", re: /\b(curl|wget)\b[^|\n]*\|\s*(ba)?sh\b/i },
  { name: "powershell -enc", re: /\bpowershell\b.*\s-e(nc|ncodedcommand)\b/i },
  { name: "del /s system roots", re: /\bdel\s+\/[sq]\s+[a-z]:\\/i },
  { name: "reg delete HKLM", re: /\breg\s+delete\s+HKLM/i },
  { name: "chmod -R 777 root", re: /\bchmod\s+-R\s+777\s+[\/~]/i },
  { name: "chown -R root", re: /\bchown\s+-R\s+.*\s+[\/~]/i },
  { name: "iptables -F", re: /\biptables\s+-F\b/i },
  { name: "killall -9", re: /\bkillall\s+-9\b/i },
  { name: "redirect to raw disk", re: />\s*\/dev\/sd[a-z]/i },
  { name: "mknod device", re: /\bmknod\b/i },
  { name: "modprobe kernel module", re: /\bmodprobe\b/i },
]

/**
 * Elevated-risk shell — full-auto still needs a human click (Codex-style).
 * Broader than hard-deny; benign echo/git status stay silent.
 *
 * 变体匹配原则:带 flag 的解释器执行 (`bash -lc` / `sh -xc` / `cmd /c` / `cmd.exe /c`)
 * 一律走 elevated,因为参数会被 shell 解释;参数解析不可靠 → 宁严勿松。
 * deny 列表的 hard block 优先;下面这条只用来触发"仍需确认"。
 *
 * 模式分段:
 *   1) 关键字段:rm/curl/powershell 等危险工具
 *   2) 解释器段:bash/sh/zsh/ksh/fish/cmd/pwsh + 任意短 flag 组合 + -c
 *      (兼容 -c / -lc / -xc / -lxc / -l -c / -x -c 等所有 POSIX getopt 形式)
 *   3) cmd.exe /c 段(独立)
 */
const ELEVATED_SHELL_RE = new RegExp(
  [
    /\b(rm|rmdir|rd|del|erase|curl|wget|powershell|pwsh|reg\s|chmod|chown|kill|killall|taskkill|Remove-Item|Invoke-WebRequest|iwr\b)\b/.source,
    /(?:^|\s)(?:bash|sh|zsh|ksh|fish|cmd(?:\.exe)?|pwsh|powershell)\s+-[a-zA-Z0-9]*-?c\b/.source,
    /\bcmd(?:\.exe)?\s+\/c\b/.source,
  ].join("|"),
  "i",
)

/** 反例黑名单 — agent 不要做什么（dim9 应用）
 *
 *  正则黑名单只兜底；agent 自身该避开的反模式：
 *  ❌ 不要用 shell 写工作区外路径 — 用 write_file/apply_patch
 *  ❌ 不要用 shell 绕工具守卫（node -e "fs.writeFileSync('/etc/x')"）
 *  ❌ 不要把 API Key 写进 shell 字面量 — 会进 session 历史
 *  ❌ 不要链式下载执行 — curl|sh 已被拦，不要绕
 *  ❌ 不要用 rm 删工作区根 — 用 remove 工具它有守卫
 *  ❌ 不要无限循环 shell — agent 循环已无上限，套死循环会耗资源
 *  ❌ 不要用 shell 改 .git/ — 会污染仓库状态
 */

/** Returns a human-readable deny reason, or null if the command is allowed
 *  through the static policy (runtime still sandboxes via workspace cwd).
 */
export function deniedShellReason(command: string): string | null {
  const cmd = (command || "").trim()
  if (!cmd) return "空命令"
  for (const { name, re } of SHELL_DENY_PATTERNS) {
    if (re.test(cmd)) return `拒绝执行：${name}`
  }
  return null
}

/** True when full-auto should still surface the approval dialog. */
export function isElevatedShellRisk(command: string): boolean {
  const cmd = (command || "").trim()
  if (!cmd) return false
  if (deniedShellReason(cmd)) return true
  return ELEVATED_SHELL_RE.test(cmd)
}
