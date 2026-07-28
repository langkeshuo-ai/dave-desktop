export function isAllowedAppNavigation(targetUrl: string, currentUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const current = new URL(currentUrl)

    if (current.protocol === "file:") {
      return target.protocol === "file:" && target.pathname === current.pathname
    }

    return target.origin === current.origin
  } catch {
    return false
  }
}
