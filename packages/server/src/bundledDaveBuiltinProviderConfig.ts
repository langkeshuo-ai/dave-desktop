import { materializeDaveBuiltinProviderConfig } from "@dave/services/node";

declare const __DAVE_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

interface MaterializeBundledDaveBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 Dave Built-in Provider Config。 */
export function readBundledDaveBuiltinProviderConfig(): string {
  if (typeof __DAVE_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 Dave Built-in Provider Config");
  }
  return __DAVE_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 Dave Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledDaveBuiltinProviderConfig(
  options: MaterializeBundledDaveBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeDaveBuiltinProviderConfig(options);
}
