// Quit-flag state for the Dave Desktop main process.
//
// Lives in its own module (not src/main/index.ts) so that tray.ts and other
// modules can import { isAppQuitting, setQuitting } without creating a
// circular import back into index.ts. A circular import is what previously
// caused rollup to inline index.ts's top-level side-effecting code (app.whenReady,
// process.on hooks, the single-instance lock) twice into the bundle — observable
// in the built out/main/index.js as duplicate `initialized` guards and two
// "Dave Desktop starting up…" log calls per launch. Moving the state out breaks
// the cycle and lets rollup emit index.ts's top-level exactly once.
//
// The flag itself marks whether the app is in the middle of quitting so that
// window-close handlers can distinguish user-hide from real quit.
let quitting = false

export function setQuitting(v: boolean): void {
  quitting = v
}

export function isAppQuitting(): boolean {
  return quitting
}
