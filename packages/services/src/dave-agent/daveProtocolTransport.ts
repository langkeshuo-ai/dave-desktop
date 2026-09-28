import type { Event, IDisposable } from "@dave/rpc";
import type { DaveProtocolMessage } from "@dave/shared";

export type DaveProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface DaveProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface DaveProtocolTransport extends IDisposable {
  readonly kind: DaveProtocolTransportKind;
  readonly onMessage: Event<DaveProtocolMessage>;
  readonly onClose: Event<DaveProtocolTransportClosedEvent>;
  send(message: DaveProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
