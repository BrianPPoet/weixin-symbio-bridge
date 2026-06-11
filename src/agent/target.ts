import crypto from "node:crypto";
import { spawn } from "node:child_process";

import type {
  AgentRequest,
  AgentResponse,
  AgentTargetConfig,
  CommandAgentTargetConfig,
  HttpAgentTargetConfig,
} from "../types.js";

export async function callAgentTarget(
  config: AgentTargetConfig,
  request: AgentRequest,
): Promise<AgentResponse> {
  switch (config.type) {
    case "echo":
      return { replyText: `Echo: ${request.prompt}` };
    case "http":
      return callHttpTarget(config, request);
    case "command":
      return callCommandTarget(config, request);
  }
}

async function callHttpTarget(
  config: HttpAgentTargetConfig,
  request: AgentRequest,
): Promise<AgentResponse> {
  const body = JSON.stringify({
    prompt: request.prompt,
    requestId: request.requestId,
    source: "wechat",
    from: request.from,
    to: request.to,
    accountId: request.accountId,
    createdAt: request.createdAt,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Codex-Request-Id": request.requestId,
  };

  const secret = config.hmacSecretEnv ? process.env[config.hmacSecretEnv] : undefined;
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers["X-Codex-Timestamp"] = timestamp;
    headers["X-Codex-Signature"] = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex")}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP target ${response.status}: ${text}`);
    }
    if (config.replyMode === "ack") {
      return { replyText: config.ackText, rawText: text };
    }
    return { replyText: extractReplyText(text), rawText: text };
  } finally {
    clearTimeout(timeout);
  }
}

async function callCommandTarget(
  config: CommandAgentTargetConfig,
  request: AgentRequest,
): Promise<AgentResponse> {
  const args = config.args.map((arg) => replacePlaceholders(arg, request));
  const result = await runCommand(config.command, args, config.timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`Command target exited ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  if (config.replyMode === "ack") {
    return { replyText: config.ackText, rawText: result.stdout };
  }
  return { replyText: extractReplyText(result.stdout), rawText: result.stdout };
}

function replacePlaceholders(value: string, request: AgentRequest): string {
  return value
    .replaceAll("{prompt}", request.prompt)
    .replaceAll("{from}", request.from)
    .replaceAll("{accountId}", request.accountId)
    .replaceAll("{requestId}", request.requestId);
}

function extractReplyText(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["reply", "replyText", "response", "text", "message", "stdout"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    // Plain stdout is acceptable.
  }
  return trimmed;
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command target timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}
