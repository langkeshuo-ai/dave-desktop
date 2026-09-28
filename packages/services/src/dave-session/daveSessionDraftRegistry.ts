import type { DaveSessionStateSnapshot } from "@dave/shared";
import type {
  DaveSessionWorkspaceTarget,
  DaveTaskTarget,
} from "#src/dave-session/daveSession.js";

function getWorkspaceKey(target: DaveSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: DaveTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createDaveDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: DaveSessionWorkspaceTarget, snapshot: DaveSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: DaveTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: DaveTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
