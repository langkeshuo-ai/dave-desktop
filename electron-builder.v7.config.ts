import type { Configuration } from "electron-builder"
import baseConfig from "./electron-builder.config"

const config: Configuration = {
  ...baseConfig,
  directories: {
    ...(baseConfig.directories ?? {}),
    output: "dist-v7",
  },
  publish: undefined,
}

export default config