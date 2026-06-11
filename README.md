# weixin-symbio-bridge

Standalone WeChat iLink bridge for Symbio and other OpenClaw-like local agents.

The bridge keeps WeChat transport concerns outside your agent runtime:

1. QR-login to Tencent's iLink/ClawBot channel.
2. Long-poll direct WeChat messages.
3. Forward inbound text to a local agent target.
4. Send the agent result, or a configured acknowledgement, back to WeChat.

The default target is Symbio's loopback FSM ingress:

```bash
codex-dev-fsm ingress-http start --host 127.0.0.1 --port 8788
```

## Setup

```bash
cd /Users/brian.pan/projects/weixin-symbio-bridge
npm install
npm run build
cp config/config.sample.json ~/.config/weixin-symbio-bridge/config.json
```

Connect WeChat:

```bash
npm run dev -- login
```

Run the bridge:

```bash
npm run dev -- run
```

List accounts:

```bash
npm run dev -- accounts
```

Send a manual text message:

```bash
npm run dev -- send --to '<user-id-from-inbound-message>' --text 'hello'
```

## Agent Targets

HTTP target:

```json
{
  "agent": {
    "type": "http",
    "endpoint": "http://127.0.0.1:8788/enqueue",
    "timeoutMs": 15000,
    "replyMode": "ack",
    "ackText": "Queued for Symbio."
  }
}
```

If your HTTP endpoint returns a synchronous reply, set `replyMode` to
`response`. The bridge looks for `reply`, `replyText`, `response`, `text`,
or `message` in a JSON response.

Command target:

```json
{
  "agent": {
    "type": "command",
    "command": "codex-dev-fsm",
    "args": ["enqueue", "--wait", "--json", "{prompt}"],
    "timeoutMs": 300000,
    "replyMode": "stdout",
    "ackText": "Queued for Symbio."
  }
}
```

Placeholders available in command args:

- `{prompt}`
- `{from}`
- `{accountId}`
- `{requestId}`

Echo target for smoke tests:

```json
{
  "agent": {
    "type": "echo"
  }
}
```

## Security Notes

- This bridge stores iLink bot tokens locally under `stateDir`.
- Keep `~/.config/weixin-symbio-bridge/config.json` and `stateDir` private.
- Use `security.allowFrom` to restrict who can trigger your agent.
- The current implementation is text-first. It detects non-text messages and
  replies with `reply.unsupportedText` when configured.
- Review Tencent/WeChat ClawBot terms before commercial use.
