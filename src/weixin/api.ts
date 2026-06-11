import crypto from "node:crypto";

import type { BridgeConfig, WeixinAccount } from "../types.js";
import type { Logger } from "../util/log.js";
import type { GetUpdatesResp } from "./messages.js";
import { buildTextSendBody } from "./messages.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_BOT_TYPE = "3";
const CHANNEL_VERSION = "0.1.0";
const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = 0x00000100;

type QRCodeResponse = {
  qrcode: string;
  qrcode_img_content: string;
};

type QRStatusResponse = {
  status:
    | "wait"
    | "scaned"
    | "confirmed"
    | "expired"
    | "scaned_but_redirect"
    | "need_verifycode"
    | "verify_code_blocked"
    | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
};

export class WeixinApi {
  constructor(
    private config: BridgeConfig,
    private logger: Logger,
  ) {}

  async fetchQrCode(localTokenList: string[] = []): Promise<QRCodeResponse> {
    return this.postJson<QRCodeResponse>({
      baseUrl: DEFAULT_BASE_URL,
      endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
      body: { local_token_list: localTokenList },
      label: "get_bot_qrcode",
      timeoutMs: 35_000,
    });
  }

  async pollQrStatus(baseUrl: string, qrcode: string, verifyCode?: string): Promise<QRStatusResponse> {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    return this.getJson<QRStatusResponse>({
      baseUrl,
      endpoint,
      label: "get_qrcode_status",
      timeoutMs: 35_000,
    });
  }

  async getUpdates(params: {
    account: WeixinAccount;
    getUpdatesBuf: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<GetUpdatesResp> {
    return this.postJson<GetUpdatesResp>({
      baseUrl: params.account.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: {
        get_updates_buf: params.getUpdatesBuf,
        base_info: this.baseInfo(),
      },
      token: params.account.token,
      label: "getupdates",
      timeoutMs: params.timeoutMs ?? 35_000,
      signal: params.signal,
    });
  }

  async sendText(params: {
    account: WeixinAccount;
    to: string;
    text: string;
    contextToken?: string;
  }): Promise<void> {
    await this.postJson<unknown>({
      baseUrl: params.account.baseUrl,
      endpoint: "ilink/bot/sendmessage",
      body: {
        ...buildTextSendBody({
          to: params.to,
          text: params.text,
          contextToken: params.contextToken,
        }),
        base_info: this.baseInfo(),
      },
      token: params.account.token,
      label: "sendmessage",
      timeoutMs: 30_000,
    });
  }

  async notifyStart(account: WeixinAccount): Promise<void> {
    await this.postJson<unknown>({
      baseUrl: account.baseUrl,
      endpoint: "ilink/bot/msg/notifystart",
      body: { base_info: this.baseInfo() },
      token: account.token,
      label: "notifystart",
      timeoutMs: 10_000,
    });
  }

  async notifyStop(account: WeixinAccount): Promise<void> {
    await this.postJson<unknown>({
      baseUrl: account.baseUrl,
      endpoint: "ilink/bot/msg/notifystop",
      body: { base_info: this.baseInfo() },
      token: account.token,
      label: "notifystop",
      timeoutMs: 10_000,
    });
  }

  private baseInfo(): object {
    return {
      channel_version: CHANNEL_VERSION,
      bot_agent: this.config.botAgent,
    };
  }

  private async getJson<T>(params: {
    baseUrl: string;
    endpoint: string;
    label: string;
    timeoutMs?: number;
  }): Promise<T> {
    const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
    this.logger.debug(`GET ${redactUrl(url)}`);
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: commonHeaders(),
      },
      params.timeoutMs,
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`${params.label} ${response.status}: ${text}`);
    return JSON.parse(text) as T;
  }

  private async postJson<T>(params: {
    baseUrl: string;
    endpoint: string;
    body: object;
    token?: string;
    label: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<T> {
    const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
    this.logger.debug(`POST ${redactUrl(url)} label=${params.label}`);
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: postHeaders(params.token),
        body: JSON.stringify(params.body),
        signal: params.signal,
      },
      params.timeoutMs,
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`${params.label} ${response.status}: ${text}`);
    return text ? (JSON.parse(text) as T) : ({} as T);
  }
}

export function defaultWeixinBaseUrl(): string {
  return DEFAULT_BASE_URL;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
}

function postHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...commonHeaders(),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function redactUrl(url: URL): string {
  return url.search ? `${url.origin}${url.pathname}?<redacted>` : url.toString();
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return fetch(url, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const originalSignal = init.signal;
  const onAbort = () => controller.abort();
  if (originalSignal) {
    if (originalSignal.aborted) controller.abort();
    originalSignal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    originalSignal?.removeEventListener("abort", onAbort);
  }
}
