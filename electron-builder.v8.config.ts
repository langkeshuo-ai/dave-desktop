import type { Configuration } from "electron-builder"
import baseConfig from "./electron-builder.config"

/**
 * v8 输出配置：隔离输出目录打包（dist-v8），用于打包验证/发布候选产物，
 * 避免与运行中应用锁定的 dist-v7/win-unpacked 冲突。
 */
const config: Configuration = {
  ...baseConfig,
  directories: {
    ...(baseConfig.directories ?? {}),
    output: "dist-v8",
  },
  publish: undefined,
}

export default config
