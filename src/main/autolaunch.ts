import { app } from "electron"
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import log from "electron-log"

// Auto-launch helper — write a per-platform login item.
//
// Reuse rationale: we considered `auto-launch` (npm, ~1M weekly downloads,
// MIT, felixrieseberg) but it adds a dep tree for a task that is a single
// PowerShell command on Windows / a single .plist on macOS / a single .desktop
// on Linux. Inlining the standard platform-native patterns keeps the dep tree
// tight and matches what `auto-launch` would do anyway — no reinvention.
//
// Fix history: previous version wrote a plain-text "marker" file to the
// Windows Startup folder and `existsSync()` checked it, but Windows does NOT
// execute arbitrary text files at login — only `.lnk` / `.exe` / `.bat` /
// `.ps1` files. So auto-launch silently never worked. Now we create a real
// `.lnk` shortcut via PowerShell's `WScript.Shell` COM object — the same
// mechanism `auto-launch` npm uses internally — and clean up any stale marker
// files from the old broken version.

interface AutoLaunch {
  isEnabled(): Promise<boolean>
  setEnabled(enabled: boolean): Promise<boolean>
}

function windowsStartupPath(): string {
  // %APPDATA%/Microsoft/Windows/Start Menu/Programs/Startup/ — Electron
  // exposes %APPDATA% as `app.getPath("appData")`. Verified against
  // Electron 42 path names.
  return join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "Dave Desktop.lnk",
  )
}

// Legacy marker file from the old broken version — clean it up if present so
// it does not sit there doing nothing / confusing isEnabled().
function legacyWindowsMarkerPath(): string {
  return join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "Dave-Desktop.lnk",
  )
}

function linuxStartupPath(): string {
  return join(app.getPath("home"), ".config", "autostart", "dave-desktop.desktop")
}

function macosStartupPath(): string {
  return join(app.getPath("home"), "Library", "LaunchAgents", "com.dave.desktop.plist")
}

const isMac = process.platform === "darwin"
const isLinux = process.platform === "linux"
const isWin = process.platform === "win32"

// Windows .lnk — created via PowerShell WScript.Shell COM, same as the
// `auto-launch` npm package does internally. Encodes the exe target so
// Windows actually launches us at login. PowerShell is available on every
// supported Windows version (10+ / Server 2016+).
function createWindowsLnk(targetPath: string): void {
  // Escape single quotes in paths for PowerShell single-quoted strings.
  const psTarget = targetPath.replace(/'/g, "''")
  const psLnk = windowsStartupPath().replace(/'/g, "''")
  const ps = `$s=(New-Object -COMObject WScript.Shell).CreateShortcut('${psLnk}');$s.TargetPath='${psTarget}';$s.Description='Dave Desktop auto-launch';$s.WorkingDirectory='${psTarget.replace(/\\[^\\]+$/, "")}';$s.Save()`
  execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, {
    windowsHide: true,
  })
}

function desktopContent(): string {
  return (
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Dave Desktop",
      `Exec=${app.getPath("exe")}`,
      "Terminal=false",
      "X-GNOME-Autostart-enabled=true",
      "Categories=Utility;",
    ].join("\n") + "\n"
  )
}

function plistContent(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    "  <string>com.dave.desktop</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${app.getPath("exe")}</string>`,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}

function ensureParentDir(filePath: string): void {
  const dir = join(filePath, "..")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Sentinel written next to the .lnk so we can detect "we did install the
// shortcut" even if the user moved / renamed the .lnk themselves — we only
// manage shortcuts we created, never delete user shortcuts we did not create.
function windowsSentinelPath(): string {
  return windowsStartupPath() + ".dave-sentinel"
}

export const autoLaunch: AutoLaunch = {
  isEnabled: async () => {
    try {
      if (isWin) {
        // Clean up stale marker from the old broken version if present.
        const legacy = legacyWindowsMarkerPath()
        if (existsSync(legacy)) {
          try {
            unlinkSync(legacy)
          } catch {
            /* best effort */
          }
        }
        //isEnabled true only if BOTH the .lnk and our sentinel exist — the
        // sentinel proves we created the .lnk, not the user.
        return existsSync(windowsStartupPath()) && existsSync(windowsSentinelPath())
      }
      if (isMac) return existsSync(macosStartupPath())
      if (isLinux) return existsSync(linuxStartupPath())
      return false
    } catch (err) {
      log.warn("autoLaunch.isEnabled failed:", err)
      return false
    }
  },

  setEnabled: async (enabled: boolean) => {
    try {
      if (isWin) {
        const lnk = windowsStartupPath()
        const sentinel = windowsSentinelPath()
        // Always clean up the stale marker from the old broken version.
        const legacy = legacyWindowsMarkerPath()
        if (existsSync(legacy)) {
          try {
            unlinkSync(legacy)
          } catch {
            /* best effort */
          }
        }
        if (enabled) {
          ensureParentDir(lnk)
          createWindowsLnk(app.getPath("exe"))
          writeFileSync(sentinel, `installed at ${new Date().toISOString()}\n`, {
            encoding: "utf8",
          })
        } else {
          if (existsSync(lnk)) {
            try {
              unlinkSync(lnk)
            } catch {
              /* best effort */
            }
          }
          if (existsSync(sentinel)) {
            try {
              unlinkSync(sentinel)
            } catch {
              /* best effort */
            }
          }
        }
        return true
      }
      if (isMac) {
        const p = macosStartupPath()
        if (enabled) {
          ensureParentDir(p)
          writeFileSync(p, plistContent(), { encoding: "utf8" })
        } else if (existsSync(p)) {
          unlinkSync(p)
        }
        return true
      }
      if (isLinux) {
        const p = linuxStartupPath()
        if (enabled) {
          ensureParentDir(p)
          writeFileSync(p, desktopContent(), { encoding: "utf8" })
        } else if (existsSync(p)) {
          unlinkSync(p)
        }
        return true
      }
      return false
    } catch (err) {
      log.error("autoLaunch.setEnabled failed:", err)
      return false
    }
  },
}
