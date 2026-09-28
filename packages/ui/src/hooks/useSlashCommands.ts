/**
 * Dave Agent Slash Commands 便捷 hook
 *
 * 返回当前 workspace 下 Agent 广播的可用 slash commands 列表。
 */
import { useDaveSessionStore, selectWorkspaceDaveState } from "../store/daveSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useDaveSessionStore(
    (state) => selectWorkspaceDaveState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
