import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function defaultConfigPath(): string {
  return path.join(os.homedir(), ".config", "weixin-symbio-bridge", "config.json");
}

export function normalizeAccountId(raw: string): string {
  return raw.trim().replace(/@/g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
}
