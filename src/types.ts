export type LogLevel = "debug" | "info" | "warn" | "error";

export type ReplyConfig = {
  maxChars: number;
  unsupportedText?: string;
};

export type SecurityConfig = {
  allowFrom: string[];
};

export type HttpAgentTargetConfig = {
  type: "http";
  endpoint: string;
  timeoutMs: number;
  replyMode: "ack" | "response";
  ackText: string;
  hmacSecretEnv?: string;
};

export type CommandAgentTargetConfig = {
  type: "command";
  command: string;
  args: string[];
  timeoutMs: number;
  replyMode: "ack" | "stdout";
  ackText: string;
};

export type EchoAgentTargetConfig = {
  type: "echo";
};

export type AgentTargetConfig =
  | HttpAgentTargetConfig
  | CommandAgentTargetConfig
  | EchoAgentTargetConfig;

export type BridgeConfig = {
  stateDir: string;
  botAgent: string;
  logLevel: LogLevel;
  security: SecurityConfig;
  reply: ReplyConfig;
  agent: AgentTargetConfig;
};

export type WeixinAccount = {
  accountId: string;
  rawAccountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
};

export type AgentRequest = {
  requestId: string;
  prompt: string;
  from: string;
  to?: string;
  accountId: string;
  createdAt: string;
};

export type AgentResponse = {
  replyText?: string;
  rawText?: string;
};
