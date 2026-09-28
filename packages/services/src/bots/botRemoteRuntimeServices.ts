import {
  ChannelClient,
  MessagePortProtocol,
  ProxyChannel,
  type MessagePortLike,
  type MessagePortPayload,
} from "@dave/rpc";
import {
  IDaveTaskService,
  type IDaveTaskService as IDaveTaskServiceShape,
} from "#src/session/daveTaskService.js";
import {
  IDaveAgentService,
  type IDaveAgentService as IDaveAgentServiceShape,
} from "#src/dave-agent/daveAgent.js";
import {
  IDaveSessionService,
  type IDaveSessionService as IDaveSessionServiceShape,
} from "#src/dave-session/daveSession.js";
import {
  IModelSelectionService,
  type IModelSelectionService as IModelSelectionServiceShape,
} from "#src/model-provider/providerFacadeServices.js";

interface PortLike {
  on?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  off?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  addEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  removeEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  postMessage(message: MessagePortPayload): void;
  start?(): void;
  close?(): void;
}

function toMessagePortLike(port: PortLike): MessagePortLike {
  return {
    addEventListener(type, listener) {
      if (port.addEventListener) {
        port.addEventListener(type, listener);
        return;
      }
      port.on?.(type, listener);
    },
    removeEventListener(type, listener) {
      if (port.removeEventListener) {
        port.removeEventListener(type, listener);
        return;
      }
      port.off?.(type, listener);
    },
    postMessage(data) {
      port.postMessage(data);
    },
    start() {
      port.start?.();
    },
    close() {
      port.close?.();
    },
  };
}

export interface RemoteBotWorkspaceRuntimeServices {
  daveAgentService: IDaveAgentServiceShape;
  daveTaskService: IDaveTaskServiceShape;
  daveSessionService: IDaveSessionServiceShape;
  modelSelectionService: IModelSelectionServiceShape;
}

export function createRemoteRuntimeServicesFromPort(
  port: unknown,
): RemoteBotWorkspaceRuntimeServices {
  const protocol = new MessagePortProtocol(toMessagePortLike(port as PortLike));
  const client = new ChannelClient(protocol);
  return {
    daveAgentService: ProxyChannel.toService<IDaveAgentServiceShape>(
      client.getChannel(IDaveAgentService.channelName),
    ),
    daveTaskService: ProxyChannel.toService<IDaveTaskServiceShape>(
      client.getChannel(IDaveTaskService.channelName),
    ),
    daveSessionService: ProxyChannel.toService<IDaveSessionServiceShape>(
      client.getChannel(IDaveSessionService.channelName),
    ),
    modelSelectionService: ProxyChannel.toService<IModelSelectionServiceShape>(
      client.getChannel(IModelSelectionService.channelName),
    ),
  };
}
