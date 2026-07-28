import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const MAX_REDIRECTS = 3

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]
  if (normalized === "::" || normalized === "::1") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith("ff")) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isBlockedIpv4(mapped[1]) : false
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return !isBlockedIpv4(address)
  if (version === 6) return !isBlockedIpv6(address)
  return false
}

export function normalizeCustomProviderBase(raw: string): string {
  const input = raw.trim()
  if (!input) throw new Error("自定义 Provider 地址不能为空")

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("自定义 Provider 地址无效")
  }

  if (url.protocol !== "https:") throw new Error("自定义 Provider 仅允许 HTTPS")
  if (url.username || url.password) throw new Error("自定义 Provider 地址不得包含用户名或密码")
  if (url.port && url.port !== "443") throw new Error("自定义 Provider 仅允许 HTTPS 默认端口 443")
  if (url.search || url.hash) throw new Error("自定义 Provider 基础地址不得包含查询参数或片段")

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("自定义 Provider 不得指向本机地址")
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error("自定义 Provider 不得指向私网、回环或保留地址")
  }

  url.hostname = hostname
  return url.toString().replace(/\/$/, "")
}

async function assertPublicDestination(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new Error("Provider 目标解析到非公网地址")
    return
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error("无法解析 Provider 主机名")
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Provider 主机名解析到非公网地址")
  }
}

export async function fetchPublicHttps(
  input: string,
  init: RequestInit,
  redirectsLeft = MAX_REDIRECTS,
): Promise<Response> {
  const normalized = normalizeCustomProviderBase(input)
  const url = new URL(normalized)
  await assertPublicDestination(url)

  const response = await fetch(url, { ...init, redirect: "manual" })
  if (response.status < 300 || response.status >= 400) return response

  const location = response.headers.get("location")
  if (!location) return response
  if (redirectsLeft <= 0) throw new Error("Provider 重定向次数过多")

  const nextUrl = new URL(location, url)
  const nextInit = { ...init }
  if (nextUrl.origin !== url.origin && nextInit.headers) {
    const headers = new Headers(nextInit.headers)
    headers.delete("authorization")
    headers.delete("proxy-authorization")
    headers.delete("cookie")
    nextInit.headers = headers
  }
  return fetchPublicHttps(nextUrl.toString(), nextInit, redirectsLeft - 1)
}
