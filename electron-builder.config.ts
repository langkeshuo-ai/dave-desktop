import type { Configuration } from "electron-builder"

const config: Configuration = {
  appId: "com.dave.desktop",
  productName: "DaveDesktop",
  artifactName: "dave-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Source package.json declares "type": "module" so vite/electron-vite tooling
  // and config files load as ESM during development. electron-vite is configured
  // to bundle both main and preload as CommonJS (`format: "cjs"`, see
  // electron.vite.config.ts). For the packaged app to load those .js files as
  // CJS at runtime, the package.json *inside* app.asar must not declare
  // "type": "module" — otherwise Node's ESM loader throws
  // "exports is not defined in ES module scope" (see electron-userland/
  // electron-builder issue #8036). `extraMetadata` deep-assigns into the
  // asar's package.json at pack time, rewriting `type` to `commonjs` without
  // touching the source package.json. Verified against app-builder-lib
  // fileTransformer.js modifyMainPackageJson (v26.15).
  extraMetadata: { type: "commonjs" },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [],
  // 发布策略:GitHub Releases(供 electron-updater 消费)。
  // 打包时生成 latest.yml;tag 推送由 .github/workflows/release.yml 触发打包+上传。
  // 代码签名:证书经 CI 环境变量 WIN_CSC_LINK(WIN_CSC_KEY_PASSWORD)注入,
  // 未配置证书时 electron-builder 自动跳过签名,不阻塞本地打包。
  publish: {
    provider: "github",
    owner: "langkeshuo-ai",
    repo: "dave-desktop",
    releaseType: "release",
  },
  win: {
    icon: "resources/icon.ico",
    target: ["nsis", "portable"],
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: "resources/icon.ico",
    installerHeaderIcon: "resources/icon.ico",
    // Distinct from portable so the two targets do not overwrite each other.
    artifactName: "dave-desktop-${os}-${arch}-setup.${ext}",
  },
  portable: {
    artifactName: "dave-desktop-${os}-${arch}-portable.${ext}",
  },
  mac: {
    // 必须用 .icns（icon-tool 只接受 .png/.svg/.icns，拒绝 .ico）：
    // 此前指向 icon.ico，macos runner 上 icon-tool.js 报
    // "Unsupported input format .ico. Supported: .png, .svg, .icns"（release run
    // 33751806833）。icon.icns 为本地从 512px PNG 预制（PNG-based 容器，
    // 含 ic07/ic08/ic09），macos runner 无需任何实时转换。
    icon: "resources/icon.icns",
    category: "public.app-category.productivity",
    target: ["dmg", "zip"],
  },
  linux: {
    // electron-builder accepts a single .png for linux too; only require a
    // dedicated icons/ directory when present.
    icon: "resources/icon.png",
    category: "Utility",
    target: ["AppImage", "deb"],
  },
}

export default config
