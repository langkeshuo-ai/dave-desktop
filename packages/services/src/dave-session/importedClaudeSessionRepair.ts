import type { DaveSessionStateSnapshot } from "@dave/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { repairImportedClaudeSessionSnapshot } from "#src/session/claude-native/importedClaudeHistoryRepair.js";
import type { IDaveAgentService } from "#src/dave-agent/daveAgent.js";
import type {
  DaveSessionReadParams,
  DaveSessionResumeParams,
} from "#src/dave-session/daveSession.js";

const logger = createServiceLogger("dave-session-service");

export async function repairEmptyImportedClaudeSessionSnapshot(params: {
  agentService: IDaveAgentService;
  snapshot: DaveSessionStateSnapshot;
  target: DaveSessionResumeParams | DaveSessionReadParams;
}): Promise<DaveSessionStateSnapshot> {
  const repaired = await repairImportedClaudeSessionSnapshot({
    snapshot: params.snapshot,
    target: {
      workspacePath: params.target.workspacePath,
      workspaceIdentity: params.target.workspaceIdentity,
      taskId: params.target.sessionId,
      ...("mcpServers" in params.target && params.target.mcpServers
        ? { mcpServers: params.target.mcpServers }
        : {}),
    },
    createSession: (input) => params.agentService.createSession(input),
    onRepair: (history) => {
      logger.warn(
        undefined,
        `[dave-session-service] Claude 导入 session 历史异常，按 ${history.source} 回填 taskId=${params.target.sessionId}`,
      );
    },
  });
  return repaired ?? params.snapshot;
}
