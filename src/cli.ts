#!/usr/bin/env node
import { loadConfig, writeSampleConfig } from "./config.js";
import { StateStore } from "./state/store.js";
import { Logger } from "./util/log.js";
import { WeixinApi } from "./weixin/api.js";
import { loginWithQr } from "./weixin/login.js";
import { WeixinSymbioBridge } from "./bridge.js";

type ParsedArgs = {
  command: string;
  options: Record<string, string | boolean>;
  positionals: string[];
};

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--help") || process.argv.slice(2).includes("-h")) {
    usage();
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.options.help) {
    usage();
    return;
  }

  if (parsed.command === "init-config") {
    const configPath = typeof parsed.options.path === "string" ? parsed.options.path : undefined;
    const outPath = writeSampleConfig(configPath);
    console.log(`Wrote ${outPath}`);
    return;
  }

  const config = loadConfig(typeof parsed.options.config === "string" ? parsed.options.config : undefined);
  const logger = new Logger(config.logLevel);
  const store = new StateStore(config.stateDir);
  const api = new WeixinApi(config, logger);
  const bridge = new WeixinSymbioBridge(config, store, logger);

  switch (parsed.command) {
    case "login":
      await loginWithQr({ api, store, logger });
      break;
    case "accounts":
      console.log(JSON.stringify(store.listAccounts().map((account) => ({
        accountId: account.accountId,
        rawAccountId: account.rawAccountId,
        baseUrl: account.baseUrl,
        userId: account.userId,
        savedAt: account.savedAt,
      })), null, 2));
      break;
    case "run": {
      const controller = new AbortController();
      process.once("SIGINT", () => controller.abort());
      process.once("SIGTERM", () => controller.abort());
      await bridge.run(
        typeof parsed.options["account-id"] === "string" ? parsed.options["account-id"] : undefined,
        controller.signal,
      );
      break;
    }
    case "send": {
      const to = requiredString(parsed.options.to, "--to");
      const text = requiredString(parsed.options.text, "--text");
      await bridge.sendManualText({
        accountId: typeof parsed.options["account-id"] === "string" ? parsed.options["account-id"] : undefined,
        to,
        text,
      });
      console.log("sent");
      break;
    }
    default:
      usage();
      process.exitCode = 2;
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const [command = "", ...rest] = args;
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "help") {
      options[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    i += 1;
  }

  return { command, options, positionals };
}

function requiredString(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required ${name}`);
  return value;
}

function usage(): void {
  console.log(`Usage:
  weixin-symbio init-config [--path <path>]
  weixin-symbio login [--config <path>]
  weixin-symbio run [--config <path>] [--account-id <id>]
  weixin-symbio accounts [--config <path>]
  weixin-symbio send [--config <path>] [--account-id <id>] --to <user> --text <text>
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
