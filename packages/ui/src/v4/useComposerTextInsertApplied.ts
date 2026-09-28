import { useCallback } from "react";
import { useDaveSessionStore } from "@/store/daveSessionStore.js";

export function useComposerTextInsertApplied(workspacePath: string, workspaceIdentity?: string) {
  return useCallback(
    (requestId: number, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        let unsubscribe: () => void = () => undefined;
        let settled = false;
        const finish = (applied: boolean) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          signal.removeEventListener("abort", handleAbort);
          resolve(applied);
        };
        const handleAbort = () => {
          const request = useDaveSessionStore
            .getState()
            .getWorkspaceState(workspacePath, workspaceIdentity).composerTextInsertRequest;
          finish(false);
          if (request?.requestId === requestId) {
            useDaveSessionStore
              .getState()
              .clearComposerTextInsertRequest(workspacePath, requestId, workspaceIdentity);
          }
        };
        const inspect = () => {
          const state = useDaveSessionStore
            .getState()
            .getWorkspaceState(workspacePath, workspaceIdentity);
          if (state.composerTextInsertVersion > requestId) {
            finish(false);
          } else if (
            state.composerTextInsertVersion === requestId &&
            state.composerTextInsertRequest === null
          ) {
            finish(true);
          }
        };
        if (signal.aborted) {
          resolve(false);
          return;
        }
        unsubscribe = useDaveSessionStore.subscribe(inspect);
        signal.addEventListener("abort", handleAbort, { once: true });
        inspect();
      }),
    [workspaceIdentity, workspacePath],
  );
}
