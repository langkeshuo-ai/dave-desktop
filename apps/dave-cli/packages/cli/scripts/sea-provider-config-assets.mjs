import { loadBuiltinProviderConfig } from "../../../../../scripts/builtin-provider-config.mjs";

export const SEA_DAVE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY = "dave-provider/dave-builtin.json";

export const collectSeaProviderConfigAssets = async ({ root, env = process.env }) => {
  const { sourcePath } = await loadBuiltinProviderConfig({ root, env });
  return {
    [SEA_DAVE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY]: sourcePath,
  };
};
