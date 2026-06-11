import fs from "node:fs";
import path from "node:path";

import type { AgentTargetConfig, BridgeConfig, LogLevel } from "./types.js";
import { defaultConfigPath, expandHome } from "./util/path.js";

type RawConfig = Partial<Omit<BridgeConfig, "agent">> & {
  agent?: Record<string, unknown>;
};

const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

function asLogLevel(value: unknown): LogLevel {
  return typeof value === "string" && LOG_LEVELS.has(value)
    ? (value as LogLevel)
    : "info";
}

function defaultAgent(): AgentTargetConfig {
  return {
    type: "http",
    endpoint: "http://127.0.0.1:8788/enqueue",
    timeoutMs: 15_000,
    replyMode: "ack",
    ackText: "Queued for Symbio.",
  };
}

function normalizeAgent(raw: RawConfig["agent"]): AgentTargetConfig {
  if (!raw?.type) return defaultAgent();
  const agentType = String(raw.type);
  if (agentType === "echo") return { type: "echo" };
  if (agentType === "http") {
    return {
      type: "http",
      endpoint: typeof raw.endpoint === "string" ? raw.endpoint : "http://127.0.0.1:8788/enqueue",
      timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : 15_000,
      replyMode: raw.replyMode === "response" ? "response" : "ack",
      ackText: typeof raw.ackText === "string" ? raw.ackText : "Queued for Symbio.",
      hmacSecretEnv: typeof raw.hmacSecretEnv === "string" ? raw.hmacSecretEnv : undefined,
    };
  }
  if (agentType === "command") {
    const args = Array.isArray(raw.args) && raw.args.every((arg: unknown) => typeof arg === "string")
      ? raw.args as string[]
      : ["enqueue", "--wait", "--json", "{prompt}"];
    return {
      type: "command",
      command: typeof raw.command === "string" ? raw.command : "codex-dev-fsm",
      args,
      timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : 300_000,
      replyMode: raw.replyMode === "ack" ? "ack" : "stdout",
      ackText: typeof raw.ackText === "string" ? raw.ackText : "Queued for Symbio.",
    };
  }
  throw new Error(`Unsupported agent.type: ${agentType}`);
}

export function loadConfig(configPath?: string): BridgeConfig {
  const resolvedPath = expandHome(configPath || process.env.WEIXIN_SYMBIO_CONFIG || defaultConfigPath());
  let raw: RawConfig = {};
  if (fs.existsSync(resolvedPath)) {
    raw = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as RawConfig;
  }

  const stateDir = expandHome(
    typeof raw.stateDir === "string" ? raw.stateDir : "~/.local/state/weixin-symbio-bridge",
  );

  return {
    stateDir,
    botAgent: typeof raw.botAgent === "string" ? raw.botAgent : "SymbioWeixinBridge/0.1.0",
    logLevel: asLogLevel(raw.logLevel),
    security: {
      allowFrom: Array.isArray(raw.security?.allowFrom)
        ? raw.security.allowFrom.filter((item): item is string => typeof item === "string" && item.trim() !== "")
        : [],
    },
    reply: {
      maxChars: typeof raw.reply?.maxChars === "number" ? raw.reply.maxChars : 3500,
      unsupportedText: typeof raw.reply?.unsupportedText === "string" ? raw.reply.unsupportedText : undefined,
    },
    agent: normalizeAgent(raw.agent),
  };
}

export function writeSampleConfig(destination?: string): string {
  const outPath = expandHome(destination || defaultConfigPath());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const sample = {
    stateDir: "~/.local/state/weixin-symbio-bridge",
    botAgent: "SymbioWeixinBridge/0.1.0",
    logLevel: "info",
    security: { allowFrom: [] },
    reply: {
      maxChars: 3500,
      unsupportedText: "I received this, but this bridge currently handles text messages only.",
    },
    agent: defaultAgent(),
  };
  fs.writeFileSync(outPath, JSON.stringify(sample, null, 2), { encoding: "utf-8", mode: 0o600 });
  return outPath;
}
