import type { Configuration } from "electron-builder"
import baseConfig from "./electron-builder.config"

/**
 * v9 输出配置：隔离输出目录打包（dist-v9），对齐最新 HEAD（含 A2' 执行轨迹卡等
 * renderer 增量），避免与运行中应用锁定的 dist-v8/win-unpacked 冲突。
 */
const config: Configuration = {
  ...baseConfig,
  directories: {
    ...(baseConfig.directories ?? {}),
    output: "dist-v9",
  },
  publish: undefined,
}

export default config
