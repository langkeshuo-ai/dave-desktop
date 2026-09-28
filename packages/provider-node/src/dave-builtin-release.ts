import { z } from "zod";
import {
  parseDaveBuiltinModelConfigRules,
  parseDaveBuiltinProviderConfigRules,
  type ModelConfigRules,
  type ProviderConfigMap,
  type ProviderTemplateMap,
} from "@dave/provider";

export const DAVE_BUILTIN_RELEASE_SCHEMA_VERSION = 1 as const;
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

export interface DaveBuiltinConfigContent {
  readonly providers: ProviderConfigMap;
  readonly providerTemplates: ProviderTemplateMap;
  readonly modelConfigRules: ModelConfigRules;
}

export interface DaveBuiltinRelease {
  readonly schemaVersion: typeof DAVE_BUILTIN_RELEASE_SCHEMA_VERSION;
  readonly revision: number;
  readonly config: DaveBuiltinConfigContent;
}

const releaseSchema = z
  .object({
    schemaVersion: z.literal(DAVE_BUILTIN_RELEASE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    config: z
      .object({
        providerConfigRules: z.unknown(),
        modelConfigRules: z.unknown(),
      })
      .strict(),
  })
  .strict();

export function decodeDaveBuiltinRelease(input: unknown): DaveBuiltinRelease {
  const parsed = releaseSchema.parse(input);
  const { providers, providerTemplates } = parseDaveBuiltinProviderConfigRules(
    parsed.config.providerConfigRules,
  );
  // ZAPI 已退出产品，旧 Remote Release 或 LKG 不能在 Renderer 静态入口删除后
  // 又通过目标 Host Registry 将它重新发布。拒绝整份不兼容 Release，让 Source 回落到兼容候选。
  if (providers.has(RETIRED_ZAPI_PROVIDER_ID)) {
    throw new Error(`Dave Built-in Release 包含已退出的 Provider: ${RETIRED_ZAPI_PROVIDER_ID}`);
  }
  return Object.freeze({
    schemaVersion: DAVE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: parsed.revision,
    config: Object.freeze({
      providers,
      providerTemplates,
      modelConfigRules: parseDaveBuiltinModelConfigRules(parsed.config.modelConfigRules),
    }),
  });
}

export function encodeDaveBuiltinRelease(release: DaveBuiltinRelease): object {
  return {
    schemaVersion: DAVE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: release.revision,
    config: {
      providerConfigRules: {
        templateRules: release.config.providerTemplates.toJSON(),
        providerRules: release.config.providers.toJSON(),
      },
      modelConfigRules: release.config.modelConfigRules.toDaveBuiltinJSON(),
    },
  };
}

export function serializeDaveBuiltinRelease(release: DaveBuiltinRelease): string {
  return JSON.stringify(encodeDaveBuiltinRelease(release));
}
