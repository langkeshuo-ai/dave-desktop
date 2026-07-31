/* =========================================================================
   Secure storage — Electron safeStorage wrapper for API keys and secrets.
   Replaces the XOR-KDF encryption in store.ts with OS-level encryption
   (DPAPI on Windows, Keychain on macOS, libsecret on Linux).

   使用模式:
     const secure = getSecureStorage()
     await secure.set("openai-api-key", "sk-...")
     const key = await secure.get("openai-api-key")  // 解密后明文
   ========================================================================= */

import { safeStorage } from "electron"
import log from "electron-log"

let initialized = false
let available = false
/** encrypt/decrypt 必须走同一 API 路径(async 或 sync)。
 *  之前 tryAsync 每次运行时探测,encrypt 走 async 而 decrypt 探测失败
 *  降级 sync,async(支持 key rotation)与 sync 密文格式不兼容 →
 *  `decrypt failed` → API Key 读不出来(渲染端守卫误判"未配置")。
 *  现在初始化时一次性决定,写入与读取永远同路径。 */
let useAsyncApi = false

/** 异步初始化 safeStorage。必须在 app.whenReady 之后调用。 */
export async function initSecureStorage(): Promise<void> {
  if (initialized) return
  initialized = true

  try {
    // 优先使用异步 API(推荐,支持 key rotation)
    const api = asyncApi()
    if (api && (await api.isAsyncEncryptionAvailable())) {
      available = true
      useAsyncApi = true
      log.info("secure-storage: async encryption available")
      return
    }
  } catch {
    // 降级到同步 API
  }

  available = safeStorage.isEncryptionAvailable()
  if (!available) {
    log.error("secure-storage: NOT available — refusing to persist secrets")
    return
  }

  // Linux: 检查是否 basic_text(硬编码密码,无实际保护)
  if (process.platform === "linux") {
    try {
      const backend = safeStorage.getSelectedStorageBackend()
      if (backend === "basic_text") {
        log.error(
          "secure-storage: Linux basic_text backend detected — REFUSING to store secrets securely",
        )
        available = false
        return
      }
      log.info("secure-storage: Linux backend:", backend)
    } catch {
      // getSelectedStorageBackend 仅 Linux 可用
    }
  }

  useAsyncApi = false
  log.info("secure-storage: synchronous encryption available")
}

/** 加密字符串,返回 hex 编码的密文。可在 app.whenReady 前调用(返回 null)。 */
export async function encrypt(plain: string): Promise<string | null> {
  if (!available || !plain) return null
  try {
    const buf = useAsyncApi
      ? await asyncApi()!.encryptStringAsync(plain)
      : safeStorage.encryptString(plain)
    return buf.toString("hex")
  } catch (err) {
    log.error("secure-storage: encrypt failed:", err instanceof Error ? err.message : String(err))
    return null
  }
}

/** 解密 hex 编码的密文,返回明文。失败返回 null。 */
export async function decrypt(hex: string): Promise<string | null> {
  if (!available || !hex) return null
  try {
    const buf = Buffer.from(hex, "hex")
    if (useAsyncApi) {
      // Electron 42:decryptStringAsync 返回 { shouldReEncrypt, result } ——
      // 字段名是 result,不是 plainText(取错字段 → undefined → "decrypt failed for")。
      const res = await asyncApi()!.decryptStringAsync(buf)
      return res.result
    }
    return safeStorage.decryptString(buf)
  } catch (err) {
    log.error("secure-storage: decrypt failed:", err instanceof Error ? err.message : String(err))
    return null
  }
}

/* 异步 safeStorage API(Electron 支持 key-rotation)。
   decryptStringAsync 返回 { shouldReEncrypt, result }(见 Electron 42 d.ts)。 */
type AsyncSafeStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plain: string): Promise<Buffer>
  decryptStringAsync(cipher: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>
}

function asyncApi(): AsyncSafeStorage | null {
  const s = safeStorage as unknown as Partial<AsyncSafeStorage>
  if (
    typeof s.isAsyncEncryptionAvailable === "function" &&
    typeof s.encryptStringAsync === "function" &&
    typeof s.decryptStringAsync === "function"
  ) {
    return s as AsyncSafeStorage
  }
  return null
}

/** 检查加密是否可用。 */
export function isSecureStorageAvailable(): boolean {
  return available
}
