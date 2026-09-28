import type { ModelSwitchStage } from "@/store/daveSessionStoreTypes.js";

export function shouldBlockTaskSelectionDuringModelRestart(
  modelSwitchPending: boolean,
  modelSwitchStage: ModelSwitchStage,
): boolean {
  return modelSwitchPending && modelSwitchStage === "restartingRuntime";
}
