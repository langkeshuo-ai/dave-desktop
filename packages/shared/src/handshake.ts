export interface HelloMessage {
  type: "dave-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "dave-hello-ack";
  version: string;
  clientId: string;
}
