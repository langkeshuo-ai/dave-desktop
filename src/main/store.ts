import StoreImport from "electron-store"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { app } from "electron"
import { resolveDefaultExport } from "./esm-interop"
import log from "electron-log"

// electron-store@11 is pure ESM. Our main process is bundled as CJS for Electron,
// so `require("electron-store")` returns `{ default: ElectronStore, __esModule: true }`
// rather than the constructor. Without unwrapping, `new ElectronStore()` throws
// "ElectronStore is not a constructor" and the app never creates a window.
type ElectronStore = InstanceType<typeof StoreImport>
const ElectronStore = resolveDefaultExport(StoreImport) as typeof StoreImport

// 安全存储模块用 dynamic import + 内部缓存,允许测试通过 vi.doMock 注入 mock。
// secure-storage 模块顶部 import 会在 vitest 注入 electron mock 之前就执行,
// 导致 mock 失效。改用 lazy getter 解耦。
let _encrypt: ((plain: string) => Promise<string | null>) | null = null
let _decrypt: ((hex: string) => Promise<string | null>) | null = null
let _isAvail: (() => boolean) | null = null
async function ensureSecure(): Promise<void> {
  if (_encrypt) return
  const m = await import("./secure-storage")
  _encrypt = m.encrypt
  _decrypt = m.decrypt
  _isAvail = m.isSecureStorageAvailable
  // initSecureStorage 必须先调用以设置 available 标志,
  // 否则 isSecureStorageAvailable() 永远返回 false。
  await m.initSecureStorage()
}
async function secureEncrypt(plain: string): Promise<string | null> {
  await ensureSecure()
  return _encrypt!(plain)
}
async function secureDecrypt(hex: string): Promise<string | null> {
  await ensureSecure()
  return _decrypt!(hex)
}
function secureAvail(): boolean {
  return _isAvail ? _isAvail() : false
}
/** 测试注入:重置内部缓存,让 vi.doMock 后重新 import。 */
export function _resetSecureCacheForTest(): void {
  _encrypt = null
  _decrypt = null
  _isAvail = null
}

let store: ElectronStore | null = null

// API key 前缀 — 所有以 -api-key 结尾的 store key 走 safeStorage 加密存储。
const API_KEY_SUFFIX = "-api-key"
const SECURE_VALUE_PREFIX = "safe-storage:v1:"

export function getStore(): ElectronStore {
  if (!store) {
    // Ensure userData dir exists before electron-store tries to write there.
    const userData = app.getPath("userData")
    if (!existsSync(userData)) mkdirSync(userData, { recursive: true })

    store = new ElectronStore({
      name: "dave-desktop-config",
      // 不再使用 XOR-KDF 加密整个文件,改用 safeStorage 逐字段加密 API Key。
      // 其他配置项(theme/cwd/mode 等)无需加密,明文存储即可。
      clearInvalidConfig: true,
    })
  }
  return store
}

export function getStorePath(): string {
  return store?.path ?? join(app.getPath("userData"), "dave-desktop-config.json")
}

/** 判断 key 是否为 API Key 字段(需要安全存储)。 */
function isApiKey(key: string): boolean {
  return key.endsWith(API_KEY_SUFFIX)
}

/** 安全读取:API Key 走 safeStorage 解密,其他 key 直接读。 */
export async function getSecure(key: string): Promise<string | null> {
  if (!isApiKey(key)) {
    return (getStore().get(key) as string) ?? null
  }
  const stored = getStore().get(key) as string | undefined
  if (!stored) return null
  if (!stored.startsWith(SECURE_VALUE_PREFIX)) {
    log.error(`secure-storage: refusing legacy plaintext or unrecognized value for ${key}`)
    return null
  }

  await ensureSecure()
  if (!secureAvail()) {
    log.error(`secure-storage: unavailable while reading ${key}`)
    return null
  }

  const cipherHex = stored.slice(SECURE_VALUE_PREFIX.length)
  if (!cipherHex || !/^[0-9a-f]+$/i.test(cipherHex) || cipherHex.length % 2 !== 0) {
    log.error(`secure-storage: invalid encrypted envelope for ${key}`)
    return null
  }
  try {
    const plain = await secureDecrypt(cipherHex)
    if (!plain) log.error(`secure-storage: decrypt failed for ${key}`)
    return plain
  } catch (error) {
    log.error(
      `secure-storage: decrypt threw for ${key}:`,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

/** 安全写入:API Key 走 safeStorage 加密后再存,其他 key 直接写。 */
export async function setSecure(key: string, value: string): Promise<void> {
  if (!isApiKey(key)) {
    getStore().set(key, value)
    return
  }
  if (!value) {
    getStore().delete(key)
    return
  }
  // 先触发 ensureSecure() 填充 _isAvail（内部会 initSecureStorage），
  // 否则无法判断系统安全存储是否可用；不可用时必须拒绝持久化。
  await ensureSecure()
  if (!secureAvail()) {
    throw new Error("系统安全存储不可用，已拒绝保存 API Key")
  }
  const hex = await secureEncrypt(value)
  if (!hex) {
    throw new Error("API Key 加密失败，未保存")
  }
  getStore().set(key, `${SECURE_VALUE_PREFIX}${hex}`)
  log.info(`secure-storage: encrypted ${key}`)
}
