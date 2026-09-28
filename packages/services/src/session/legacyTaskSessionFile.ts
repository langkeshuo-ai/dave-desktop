import type { DaveSessionFile, DaveTaskMeta } from "@dave/shared";
import { daveSessionFileSchema, daveTaskMetaSchema, daveTaskModeSchema } from "@dave/shared";

export type LegacyTaskSessionFile = Omit<DaveSessionFile, "meta"> & {
  meta: Omit<DaveTaskMeta, "mode"> & { mode?: DaveTaskMeta["mode"] };
};

const legacyTaskSessionFileSchema = daveSessionFileSchema.extend({
  // Claude 原生迁移会按清洗路径删除 meta.mode。
  // legacy snapshot 读取/写入仍要校验其它必需字段，但不能再强制把被过滤字段补回文件。
  meta: daveTaskMetaSchema.extend({
    mode: daveTaskModeSchema.optional(),
  }),
});

export function parseLegacyTaskSessionFile(input: unknown): LegacyTaskSessionFile {
  return legacyTaskSessionFileSchema.parse(input);
}

export function safeParseLegacyTaskSessionFile(input: unknown) {
  return legacyTaskSessionFileSchema.safeParse(input);
}
