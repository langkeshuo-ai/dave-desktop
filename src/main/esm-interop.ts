/**
 * Unwrap a pure-ESM default export when the main process is bundled as CJS.
 *
 * electron-store / conf v15+ ship `"type": "module"`. Under Electron's CJS
 * main bundle, `require(pkg)` yields `{ default: X, __esModule: true }` rather
 * than `X`. Calling `new require(... )` then throws "is not a constructor"
 * and aborts startup before any window is created.
 *
 * Named imports (`import { execa } from "execa"`) are fine — rollup rewrites
 * them to `mod.execa`. Only default imports of pure-ESM packages need this.
 */
export function resolveDefaultExport<T = unknown>(mod: unknown): T {
  if (typeof mod === "function") return mod as T
  if (mod && typeof mod === "object") {
    const def = (mod as { default?: unknown }).default
    if (typeof def === "function") return def as T
    if (def !== undefined) return def as T
  }
  throw new TypeError(
    `ESM interop: module did not provide a usable default export (got ${typeof mod})`,
  )
}
