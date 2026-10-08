# The phone

Part of [the MCP server](../the-mcp.md): every tool of this stage, what each parameter takes — read off the
tool's own schema, as the assistant sees it — and one real call, answered by Pinecall Cloud.

## `line`

Who answers the agent's number right now and who could take it; which phone is the person's own, so their calls reach their copy.

`line show` says whose process a ring at the agent's number lands in. `from <number>` says which phone is the person's own, once: their calls reach the copy they hold (the one `start` holds) while everybody else reaches production. `claim` takes the line for this copy, `release` gives it back, `forget` drops the phone.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `show` · `from` · `forget` · `claim` · `release` | required | show whose process a ring lands in; from says which phone is the person's own; forget drops it; claim takes the line for this copy; release gives it back |
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `number` | text |  | `from`: the person's own phone, in +E.164 |
| `prod` | true or false |  | act in production instead of the sandbox; only a server installed with `pinecall mcp install --prod` may, and the org's own switch still decides |

```json title="called with"
{
  "action": "show"
}
```

```json title="answered"
{
  "agent": "front-desk",
  "env": "sandbox",
  "held": true,
  "holding": {
    "holder": "m_4f1c2a9b0e7d",
    "name": "you@example.com"
  },
  "yours": true,
  "waiting": [],
  "calling": []
}
```

## `numbers`

The org's numbers and the agent each reaches; the numbers its carrier account owns; importing one, shown as steps before anything is written.

`numbers list` shows which number reaches which agent in the sandbox; `available` what the org's Twilio account owns. `import` points a number the account owns at an agent: it first answers the steps it would take and writes nothing; call again with `dry_run: false` to do them. Letting a number go is never a tool: `pinecall numbers drop` in a terminal.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `list` · `available` · `import` | required | list the org's numbers; available is what its carrier account owns; import points one at an agent, a dry run unless dry_run is false |
| `number` | text |  | `import`: the number, in +E.164 |
| `agent` | text |  | `import`: the agent that answers it |
| `channel` | `phone` · `whatsapp` |  | `import`: phone unless it is a WhatsApp number |
| `account` | text |  | `available`: one carrier account, when the org has several |
| `dry_run` | true or false |  | `import`: true (the default) prints the steps and writes nothing; false does them |
| `prod` | true or false |  | act in production instead of the sandbox; only a server installed with `pinecall mcp install --prod` may, and the org's own switch still decides |

```json title="called with"
{
  "action": "list"
}
```

```json title="answered"
{
  "numbers": [
    {
      "route": {
        "org": "org_98889a61509c",
        "agent": "front-desk",
        "channel": "phone",
        "number": "+15550104133",
        "label": null,
        "env": "sandbox",
        "managed": false
      },
      "origin": "imported",
      "rings": "broken",
      "last_call_at": null,
      "via": null,
      "account": "AC5f…e442"
    }
  ]
}
```

## `carriers`

The org's carrier accounts — Twilio, a SIP peer, WhatsApp — and one account's networks and how outbound calls leave. Never a secret.

`carriers` lists the org's carrier accounts and shows one. Adding one takes its secrets, so it is never a tool: the person types `pinecall carriers add` in a terminal, or uses the console's Numbers screen.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `list` · `show` | required | list the org's carrier accounts, or show one |
| `account` | text |  | `show`: the account's id |
| `prod` | true or false |  | act in production instead of the sandbox; only a server installed with `pinecall mcp install --prod` may, and the org's own switch still decides |

```json title="called with"
{
  "action": "list"
}
```

```json title="answered"
{
  "carriers": [
    {
      "kind": "twilio",
      "account": "AC5f…e442",
      "label": "",
      "networks": []
    }
  ]
}
```

## `callbacks`

The callers waiting to be called back, oldest first: who, on which channel, through what (the overflow, the agent's own tool, the widget).

`callbacks` lists the people waiting for a call back, each with the call it came from.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | only this agent's |
| `after` | a whole number 0 or more |  | where the page before ended |
| `prod` | true or false |  | act in production instead of the sandbox; only a server installed with `pinecall mcp install --prod` may, and the org's own switch still decides |

```json title="called with"
{}
```

```json title="answered"
{
  "requests": [],
  "next": null
}
```
