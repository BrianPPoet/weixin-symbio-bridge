import crypto from "node:crypto";

import { callAgentTarget } from "./agent/target.js";
import type { BridgeConfig, WeixinAccount } from "./types.js";
import type { Logger } from "./util/log.js";
import type { StateStore } from "./state/store.js";
import { WeixinApi } from "./weixin/api.js";
import { extractText, hasNonTextContent, MessageType, type WeixinMessage } from "./weixin/messages.js";

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 2000;
const BACKOFF_DELAY_MS = 30_000;

export class WeixinSymbioBridge {
  private api: WeixinApi;

  constructor(
    private config: BridgeConfig,
    private store: StateStore,
    private logger: Logger,
  ) {
    this.api = new WeixinApi(config, logger);
  }

  async run(accountId?: string, abortSignal?: AbortSignal): Promise<void> {
    const accounts = accountId
      ? [this.store.loadAccount(accountId)].filter((account): account is WeixinAccount => account !== undefined)
      : this.store.listAccounts();

    if (!accounts.length) {
      throw new Error("No WeChat accounts found. Run `weixin-symbio login` first.");
    }

    await Promise.all(accounts.map((account) => this.monitorAccount(account, abortSignal)));
  }

  async sendManualText(params: {
    accountId?: string;
    to: string;
    text: string;
  }): Promise<void> {
    const account = this.resolveAccount(params.accountId);
    const contextToken = this.store.getContextToken(account.accountId, params.to);
    await this.api.sendText({
      account,
      to: params.to,
      text: this.truncate(params.text),
      contextToken,
    });
  }

  private async monitorAccount(account: WeixinAccount, abortSignal?: AbortSignal): Promise<void> {
    this.logger.info(`Starting WeChat monitor account=${account.accountId}`);
    await this.api.notifyStart(account).catch((error: unknown) => {
      this.logger.warn(`notifystart failed for ${account.accountId}: ${String(error)}`);
    });

    let getUpdatesBuf = this.store.loadSyncBuf(account.accountId);
    let failures = 0;

    while (!abortSignal?.aborted) {
      try {
        const response = await this.api.getUpdates({
          account,
          getUpdatesBuf,
          timeoutMs: 35_000,
          signal: abortSignal,
        });
        failures = 0;
        if (response.get_updates_buf) {
          getUpdatesBuf = response.get_updates_buf;
          this.store.saveSyncBuf(account.accountId, getUpdatesBuf);
        }
        if (response.ret !== undefined && response.ret !== 0) {
          this.logger.warn(
            `getupdates ret=${response.ret} errcode=${response.errcode ?? ""} errmsg=${response.errmsg ?? ""}`,
          );
          await sleep(BACKOFF_DELAY_MS, abortSignal);
          continue;
        }
        for (const message of response.msgs ?? []) {
          await this.handleMessage(account, message);
        }
      } catch (error) {
        if (abortSignal?.aborted) break;
        failures += 1;
        this.logger.warn(`getupdates failed account=${account.accountId} failures=${failures}: ${String(error)}`);
        await sleep(failures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, abortSignal);
      }
    }

    await this.api.notifyStop(account).catch((error: unknown) => {
      this.logger.warn(`notifystop failed for ${account.accountId}: ${String(error)}`);
    });
  }

  private async handleMessage(account: WeixinAccount, message: WeixinMessage): Promise<void> {
    if (!message.from_user_id) return;
    if (message.message_type === MessageType.BOT) return;
    if (message.group_id) {
      this.logger.debug(`Skipping group message group=${message.group_id}`);
      return;
    }
    if (!this.isAllowed(message.from_user_id)) {
      this.logger.warn(`Skipping unauthorized sender ${message.from_user_id}`);
      return;
    }

    if (message.context_token) {
      this.store.setContextToken(account.accountId, message.from_user_id, message.context_token);
    }

    const text = extractText(message).trim();
    if (!text) {
      if (hasNonTextContent(message) && this.config.reply.unsupportedText) {
        await this.reply(account, message.from_user_id, this.config.reply.unsupportedText, message.context_token);
      }
      return;
    }

    const requestId = `wx-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    this.logger.info(`Inbound text account=${account.accountId} from=${message.from_user_id} chars=${text.length}`);

    try {
      const response = await callAgentTarget(this.config.agent, {
        requestId,
        prompt: text,
        from: message.from_user_id,
        to: message.to_user_id,
        accountId: account.accountId,
        createdAt: new Date().toISOString(),
      });
      const replyText = response.replyText?.trim();
      if (replyText) {
        await this.reply(account, message.from_user_id, replyText, message.context_token);
      }
    } catch (error) {
      this.logger.error(`Agent target failed requestId=${requestId}: ${String(error)}`);
      await this.reply(account, message.from_user_id, "Agent target failed. Check bridge logs.", message.context_token);
    }
  }

  private async reply(
    account: WeixinAccount,
    to: string,
    text: string,
    contextToken?: string,
  ): Promise<void> {
    await this.api.sendText({
      account,
      to,
      text: this.truncate(text),
      contextToken: contextToken || this.store.getContextToken(account.accountId, to),
    });
  }

  private isAllowed(from: string): boolean {
    const allowFrom = this.config.security.allowFrom;
    return allowFrom.length === 0 || allowFrom.includes(from);
  }

  private resolveAccount(accountId?: string): WeixinAccount {
    if (accountId) {
      const account = this.store.loadAccount(accountId);
      if (!account) throw new Error(`Unknown accountId: ${accountId}`);
      return account;
    }
    const accounts = this.store.listAccounts();
    if (accounts.length === 1) return accounts[0];
    if (!accounts.length) throw new Error("No WeChat accounts found. Run login first.");
    throw new Error(`Multiple accounts found. Specify --account-id (${accounts.map((a) => a.accountId).join(", ")}).`);
  }

  private truncate(text: string): string {
    const max = this.config.reply.maxChars;
    if (text.length <= max) return text;
    return `${text.slice(0, max - 40)}\n\n[truncated to ${max} chars]`;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
