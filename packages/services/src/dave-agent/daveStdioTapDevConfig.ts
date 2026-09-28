import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaveStdioTapDevState } from "@dave/shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface DaveStdioTapStateFile {
  enabled?: boolean;
}

function isDaveStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

function getDaveStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getDaveStdioTapDevLogDir(): string {
  return join(getDaveStdioTapDevDir(), "stdio-traffic");
}

function getDaveStdioTapDevStatePath(): string {
  return join(getDaveStdioTapDevDir(), "dave-stdio-tap.json");
}

function readStateFile(path: string): DaveStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as DaveStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readDaveStdioTapDevState(): DaveStdioTapDevState {
  const visible = isDaveStdioTapDevVisible();
  const statePath = getDaveStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getDaveStdioTapDevLogDir(),
    statePath,
  };
}

export function setDaveStdioTapDevEnabled(enabled: boolean): DaveStdioTapDevState {
  const visible = isDaveStdioTapDevVisible();
  const statePath = getDaveStdioTapDevStatePath();
  mkdirSync(getDaveStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        // 开发态 stdio 抓包是高频原始协议帧，只能通过显式开关写旁路文件，避免误进生产日志。
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readDaveStdioTapDevState();
}
