import { z } from "zod";

/**
 * Dave agent 提供方的单一真源。
 *
 * 类型 DaveProvider、运行时 schema daveProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / dave-protocol 等无环引用。
 */
const DAVE_PROVIDERS = ["glm"] as const;

export const daveProviderSchema = z.enum(DAVE_PROVIDERS);

export type DaveProvider = (typeof DAVE_PROVIDERS)[number];
