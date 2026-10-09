# Calls, and what they run on

Part of [the MCP server](../the-mcp.md): every tool of this stage, what each parameter takes — read off the
tool's own schema, as the assistant sees it — and one real call, answered by Pinecall Cloud.

## `calls`

The agent's newest calls: each one's id, channel, length, how it ended, its cost and its verdicts.

`calls` lists the agent's newest calls with their ids; `call` reads one whole.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `limit` | a whole number 1–100 |  | how many, newest first; 20 when left out |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{
  "limit": 2
}
```

```json title="answered"
{
  "agent": "front-desk",
  "calls": [
    {
      "call": "call_ca0bf3567bf84a528071f482b43c4a92",
      "agent": "front-desk",
      "live": false,
      "last_seq": 33,
      "status": "ended",
      "channel": "web",
      "direction": "inbound",
      "from": "web_7b7c541fea4c",
      "to": "front-desk",
      "caller": null,
      "started_at": 1791490518.67,
      "ended_at": 1791490520.76,
      "end_reason": "caller_hung_up",
      "outcome": "Your message has reached the team. Thank you for calling, and goodbye.",
      "cost": "…",
      "score": "…",
      "flags": [],
      "attention": null
    },
    "… 1 more"
  ]
}
```

## `call`

One call's log, entry by entry — every turn, tool call, result, state change, metric and verdict — a page at a time.

`call` reads one call's log the way the runtime keeps it: every entry with its seq, quiet ones included — the turns, each tool call and its result, the state after it, the latency of each turn, the cost, and the verdicts at hang-up (`call.score`). Page with `after`.

| parameter | takes | | what it is |
|---|---|---|---|
| `call` | text | required | the call's id |
| `after` | a whole number 0 or more |  | only entries after this seq: the `next` of the page before |
| `limit` | a whole number 1–500 |  | entries in this page; 200 when left out |
| `types` | a list of texts |  | only these entry types, such as turn.agent or call.score |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{
  "call": "call_ca0bf3567bf84a528071f482b43c4a92",
  "types": [
    "turn.user",
    "tool.call",
    "turn.agent",
    "call.score"
  ]
}
```

```json title="answered"
{
  "call": "call_ca0bf3567bf84a528071f482b43c4a92",
  "entries": [
    {
      "seq": 3,
      "ts": 1791490518.82,
      "call": "call_ca0bf3567bf84a528071f482b43c4a92",
      "agent": "front-desk",
      "type": "turn.user",
      "ephemeral": false,
      "data": {
        "text": "Hi, this is Ana Ruiz. My order A-1042 arrived broken, please tell the manager.",
        "item_id": "item_3d7916dcc7aa",
        "metrics": "…",
        "language": null,
        "speech_id": "speech_05809278d21d",
        "transcript_confidence": null
      }
    },
    {
      "seq": 11,
      "ts": 1791490519.77,
      "call": "call_ca0bf3567bf84a528071f482b43c4a92",
      "agent": "front-desk",
      "type": "tool.call",
      "ephemeral": false,
      "data": {
        "name": "takeMessage",
        "call_id": "toolu_01Gn8MKVAQeCDMeHeFytYmUY",
        "arguments": "…",
        "speech_id": "speech_05809278d21d"
      }
    },
    {
      "seq": 29,
      "ts": 1791490520.58,
      "call": "call_ca0bf3567bf84a528071f482b43c4a92",
      "agent": "front-desk",
      "type": "turn.agent",
      "ephemeral": false,
      "data": {
        "text": "Your message has reached the team. Thank you for calling, and goodbye.",
        "item_id": "item_217ff9c2410b",
        "metrics": "…",
        "speech_id": "speech_05809278d21d",
        "interrupted": false
      }
    },
    "… 2 more"
  ],
  "next": null
}
```

## `pipeline`

What the agent hears, decides and speaks with — the vendors and models of each stage — and the latency each measured.

`pipeline` reads the three stages a call runs on (ears, model, voice), which vendor and model each is, and the medians the agent's recent calls measured.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{}
```

```json title="answered"
{
  "agent": "front-desk",
  "hears": {
    "vendor": "deepgram",
    "model": null,
    "voice_id": null,
    "language": null
  },
  "decides": {
    "vendor": "anthropic",
    "model": null,
    "voice_id": null,
    "language": null
  },
  "speaks": {
    "vendor": "cartesia",
    "model": null,
    "voice_id": null,
    "language": null
  },
  "greeting": {
    "say": "Thanks for calling. How can I help?",
    "reply": null,
    "allow_interruptions": null
  },
  "voices": [],
  "providers": [
    {
      "name": "anthropic",
      "does": [
        "llm"
      ],
      "aliases": [],
      "note": "",
      "standing": "ready",
      "ready": true,
      "env": null,
      "extra": "anthropic",
      "voices_listed": false,
      "availability": "offered",
      "broken": null
    },
    {
      "name": "assemblyai",
      "does": [
        "stt"
      ],
      "aliases": [],
      "note": "",
      "standing": "no key",
      "ready": false,
      "env": null,
      "extra": "assemblyai",
      "voices_listed": false,
      "availability": "bring your own",
      "broken": null
    },
    "… 43 more"
  ],
  "defaults": {
    "llm": "anthropic",
    "stt": "deepgram",
    "tts": "cartesia"
  },
  "models": {
    "stt/deepgram": [
      "flux-general-multi"
    ],
    "tts/elevenlabs": [
      "eleven_flash_v2_5"
    ]
  },
  "calls": 20,
  "medians": [
    {
      "name": "llm_node_ttft",
      "seconds": 0.41,
      "turns": 34
    },
    {
      "name": "talk_share",
      "seconds": 1,
      "turns": 20
    }
  ],
  "unavailable_reasons": {}
}
```

## `providers`

The vendors an agent may run on: what each does, whether it is ready, and whose key it would run on. Never a key.

`providers` lists every speech, model and voice vendor this gateway can run, what each does, and whose key a call would use. Bringing a key of your own is never a tool: the person types `pinecall providers add <vendor>` in a terminal, or uses the console.

| parameter | takes | | what it is |
|---|---|---|---|
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{}
```

```json title="answered"
{
  "providers": [
    {
      "name": "anthropic",
      "does": [
        "llm"
      ],
      "aliases": [],
      "note": "",
      "standing": "ready",
      "ready": true,
      "env": null,
      "extra": "anthropic",
      "voices_listed": false,
      "availability": "offered",
      "broken": null
    },
    {
      "name": "assemblyai",
      "does": [
        "stt"
      ],
      "aliases": [],
      "note": "",
      "standing": "no key",
      "ready": false,
      "env": null,
      "extra": "assemblyai",
      "voices_listed": false,
      "availability": "bring your own",
      "broken": null
    },
    {
      "name": "asyncai",
      "does": [
        "tts"
      ],
      "aliases": [],
      "note": "",
      "standing": "no key",
      "ready": false,
      "env": null,
      "extra": "asyncai",
      "voices_listed": false,
      "availability": "bring your own",
      "broken": null
    },
    "… 42 more"
  ],
  "defaults": {
    "llm": "anthropic",
    "stt": "deepgram",
    "tts": "cartesia"
  },
  "voices": [],
  "models": {
    "stt/deepgram": [
      "flux-general-multi"
    ],
    "tts/elevenlabs": [
      "eleven_flash_v2_5"
    ]
  }
}
```
