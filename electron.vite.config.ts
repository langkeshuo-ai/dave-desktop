import { defineConfig } from "electron-vite"
import tailwind from "@tailwindcss/vite"
import { visualizer } from "rollup-plugin-visualizer"

// Vite injects crossorigin="anonymous" on <script type="module"> and <link rel="stylesheet">
// tags. Under Electron's file:// origin this is treated as cross-origin and refused by
// our CSP — so strip the attr from the built index.html. electron-vite does not expose
// a clean knob to disable it (`html.crossorigin: ""` is ignored in v3), so we use a tiny
// transformIndexHtml plugin.
const stripCrossorigin = () => ({
  name: "strip-crossorigin",
  transformIndexHtml(html: string) {
    return html.replace(/\s+crossorigin(\s*=\s*["'])?[^"\s>]*["']?/gi, "")
  },
})

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
        // Explicitly externalize electron so require("electron") resolves to
        // the built-in module at runtime, NOT the node_modules/electron package
        // (which exports the path to the Electron binary, not the Electron API).
        // Also externalize electron-updater — dynamic require() in index.ts.
        external: ["electron", "electron-updater"],
        output: {
          format: "cjs",
          // Pure-ESM deps (electron-store@11, conf@15) return
          // `{ default, __esModule }` from require(). Without interop, default
          // imports become non-constructors at runtime ("is not a constructor").
          // Source also unwraps via resolveDefaultExport for belt-and-suspenders.
          interop: "auto",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        // Same reasoning as main — sandbox preload scripts must resolve
        // require("electron") to the built-in module, not the npm package.
        external: ["electron"],
        output: {
          format: "cjs",
          interop: "auto",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [tailwind(), stripCrossorigin()],
    build: {
      outDir: "out/renderer",
      emptyOutDir: true,
      sourcemap: true,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: { index: "src/renderer/index.html" },
        plugins: [
          visualizer({
            filename: "out/bundle-stats.html",
            open: false,
            gzipSize: true,
            brotliSize: true,
          }) as any,
        ],
      },
    },
    server: { cors: false },
  },
})
