# Symbio Integration

Recommended first run:

```bash
codex-dev-fsm ingress-http start --host 127.0.0.1 --port 8788
```

Use the default `http` target in `config/config.sample.json`. This queues
incoming WeChat text as FSM work and replies with an acknowledgement.

For a synchronous WeChat response, use the command target:

```json
{
  "agent": {
    "type": "command",
    "command": "codex-dev-fsm",
    "args": ["enqueue", "--wait", "--json", "{prompt}"],
    "timeoutMs": 300000,
    "replyMode": "stdout"
  }
}
```

That path keeps the WeChat request open while Symbio works. Use it only after
you know typical turns complete inside WeChat's reply token lifetime.
