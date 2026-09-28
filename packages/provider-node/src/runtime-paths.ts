export const DAVE_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "DAVE_BUILTIN_PROVIDER_CONFIG_FILE";
export const DAVE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "DAVE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const DAVE_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "DAVE_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly daveBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [DAVE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.daveBuiltinFilePath,
    [DAVE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const daveBuiltinFilePath = env[DAVE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[DAVE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!daveBuiltinFilePath && !personalFilePath) return null;
  if (!daveBuiltinFilePath || !personalFilePath) {
    throw new Error("Dave Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ daveBuiltinFilePath, personalFilePath });
}
