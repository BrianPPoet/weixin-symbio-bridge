import crypto from "node:crypto";

export const MessageType = {
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const MessageState = {
  FINISH: 2,
} as const;

export type MessageItem = {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
};

export type WeixinMessage = {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
};

export type GetUpdatesResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

export function extractText(message: WeixinMessage): string {
  for (const item of message.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

export function hasNonTextContent(message: WeixinMessage): boolean {
  return (message.item_list ?? []).some((item) =>
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE,
  );
}

export function buildTextSendBody(params: {
  to: string;
  text: string;
  contextToken?: string;
}): object {
  return {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: `weixin-symbio-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: params.text
        ? [{ type: MessageItemType.TEXT, text_item: { text: params.text } }]
        : undefined,
      context_token: params.contextToken || undefined,
    },
  };
}
