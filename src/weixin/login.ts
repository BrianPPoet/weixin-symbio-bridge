import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import qrcodeTerminal from "qrcode-terminal";

import type { WeixinAccount } from "../types.js";
import type { Logger } from "../util/log.js";
import { normalizeAccountId } from "../util/path.js";
import type { StateStore } from "../state/store.js";
import { defaultWeixinBaseUrl, WeixinApi } from "./api.js";

const LOGIN_TIMEOUT_MS = 8 * 60_000;

export async function loginWithQr(params: {
  api: WeixinApi;
  store: StateStore;
  logger: Logger;
}): Promise<WeixinAccount> {
  const qr = await params.api.fetchQrCode(params.store.localBotTokens());
  if (!qr.qrcode || !qr.qrcode_img_content) {
    throw new Error("QR response did not include qrcode and qrcode_img_content");
  }

  console.log("Scan this QR code in WeChat to connect ClawBot/iLink:");
  qrcodeTerminal.generate(qr.qrcode_img_content, { small: true });
  console.log(qr.qrcode_img_content);

  const startedAt = Date.now();
  let baseUrl = defaultWeixinBaseUrl();
  let pendingVerifyCode: string | undefined;
  let scannedLogged = false;

  while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
    const status = await params.api.pollQrStatus(baseUrl, qr.qrcode, pendingVerifyCode).catch((error: unknown) => {
      params.logger.warn(`QR status poll failed, retrying: ${String(error)}`);
      return { status: "wait" as const };
    });

    switch (status.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        if (!scannedLogged) {
          console.log("\nScan detected. Confirm authorization in WeChat.");
          scannedLogged = true;
        }
        pendingVerifyCode = undefined;
        break;
      case "need_verifycode":
        pendingVerifyCode = await readLine("Enter the verification code shown in WeChat: ");
        break;
      case "verify_code_blocked":
        throw new Error("Verification code was rejected too many times. Restart login.");
      case "expired":
        throw new Error("QR code expired. Restart login.");
      case "scaned_but_redirect":
        if (status.redirect_host) {
          baseUrl = `https://${status.redirect_host}`;
          params.logger.info(`QR login redirected to ${baseUrl}`);
        }
        break;
      case "binded_redirect":
        throw new Error("This WeChat account is already bound. Existing local credentials may still work.");
      case "confirmed": {
        if (!status.bot_token || !status.ilink_bot_id) {
          throw new Error("Login confirmed, but bot token or bot id was missing.");
        }
        const account: WeixinAccount = {
          accountId: normalizeAccountId(status.ilink_bot_id),
          rawAccountId: status.ilink_bot_id,
          token: status.bot_token,
          baseUrl: status.baseurl || baseUrl,
          userId: status.ilink_user_id,
          savedAt: new Date().toISOString(),
        };
        params.store.saveAccount(account);
        console.log(`\nConnected account ${account.accountId}`);
        return account;
      }
    }

    await sleep(1000);
  }

  throw new Error("Timed out waiting for WeChat QR login.");
}

async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
