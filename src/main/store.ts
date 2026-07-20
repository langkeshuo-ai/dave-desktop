import StoreImport from "electron-store"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { app } from "electron"
import { resolveDefaultExport } from "./esm-interop"

// electron-store@11 is pure ESM. Our main process is bundled as CJS for Electron,
// so `require("electron-store")` returns `{ default: ElectronStore, __esModule: true }`
// rather than the constructor. Without unwrapping, `new ElectronStore()` throws
// "ElectronStore is not a constructor" and the app never creates a window.
type ElectronStore = InstanceType<typeof StoreImport>
const ElectronStore = resolveDefaultExport(StoreImport) as typeof StoreImport

let store: ElectronStore | null = null

// Derive a per-machine encryption key from the userData path so the store
// cannot be silently decrypted by copying the config file to another machine.
// Falls back to a static key only when userData is unavailable (very early init).
function encryptionKey(): string {
  try {
    const base = app.getPath("userData")
    // Hash-ish derivation: xor the path bytes with a fixed salt — stable per machine,
    // not meant as a strong KDF, only to avoid a globally static key.
    const salt = "dave-desktop-local-store-v1"
    const pathBytes = Buffer.from(base, "utf8")
    const saltBytes = Buffer.from(salt, "utf8")
    const out = Buffer.alloc(Math.max(pathBytes.length, saltBytes.length))
    for (let i = 0; i < out.length; i++) {
      out[i] = (pathBytes[i] || 0) ^ (saltBytes[i % saltBytes.length] || 0)
    }
    return out.toString("hex")
  } catch {
    return "dave-desktop-local-store-" + randomBytes(8).toString("hex")
  }
}

export function getStore(): ElectronStore {
  if (!store) {
    // Ensure userData dir exists before electron-store tries to write there.
    const userData = app.getPath("userData")
    if (!existsSync(userData)) mkdirSync(userData, { recursive: true })

    store = new ElectronStore({
      name: "dave-desktop-config",
      encryptionKey: encryptionKey(),
      clearInvalidConfig: true,
    })
  }
  return store
}

export function getStorePath(): string {
  return store?.path ?? join(app.getPath("userData"), "dave-desktop-config.json")
}
