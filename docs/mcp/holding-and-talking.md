# Holding the agent, and talking to it

Part of [the MCP server](../the-mcp.md): every tool of this stage, what each parameter takes — read off the
tool's own schema, as the assistant sees it — and one real call, answered by Pinecall Cloud.

## `start`

Hold the project's agent so it answers calls: in a thread of this server, reloaded on every save, or attached to a process already holding it.

`start` holds the agent the way `pinecall start` does: it answers written calls (`chat`), spoken ones from the console, and a phone ring when a number points at it. A TypeScript agent runs inside this server and reloads on every save; a save that does not load keeps the version before answering, and `status` says why. A Ruby agent is held by `pinecall start --watch` in a terminal: `start` then attaches to it. Already held on this machine (a terminal, another window), it attaches instead of fighting for the line. The console's screens reach the agent held here, through a companion this server keeps beside the thread.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `prod` | true or false |  | act in production instead of the sandbox; only a server installed with `pinecall mcp install --prod` may, and the org's own switch still decides |

```json title="called with"
{}
```

```json title="answered"
{
  "agent": "front-desk",
  "held": "thread",
  "app": "app_ac0d6d67353b",
  "version": 1,
  "environment": "sandbox"
}
```

## `stop`

Stop holding the agent: its thread drains its live calls and leaves.

`stop` lets the agent go: a thread drains the calls it holds and leaves; an attached process is left running, since this server did not start it.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | the agent's name; the project's only agent when left out |

```json title="called with"
{}
```

```json title="answered"
{
  "stopped": "front-desk"
}
```

## `status`

What this server holds: each agent, how (thread or attached), its app, the version answering, and why the newest save did not load.

`status` leads with what is wrong, if anything: the sentence a save that does not load was refused with. Otherwise each agent held, its app id and the version answering.

It takes nothing.

```json title="called with"
{}
```

```json title="answered"
{
  "held": [
    {
      "agent": "front-desk",
      "held": "thread",
      "app": "app_ac0d6d67353b",
      "version": 1,
      "environment": "sandbox"
    }
  ]
}
```

## `logs`

The last lines the held agent's thread printed: its own logs, a load error, a reload.

`logs` reads the last lines the agent printed — a tenant's own console output, a load error, the versions as they replace each other. They are kept in memory, never written where the host reads.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `lines` | a whole number 1–500 |  | how many of the last lines; 50 when left out |

```json title="called with"
{
  "lines": 6
}
```

```json title="answered"
{
  "agent": "front-desk",
  "lines": []
}
```

## `chat`

Talk to the held agent as a caller: `say` a line (opening a call, or continuing one by its id) and get its whole answer; `end` hangs up.

`chat` is a written call with the agent `start` holds. `say` without `call` opens one and answers with its id; pass that id to go on. Each answer is everything the agent did for that line: its turns, the tools it called with their arguments, their results, the state it changed. `end` hangs up, and the call is judged like any other. `contact` makes the caller someone, so memory is written and recalled.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `say` · `end` | required | say a line as the caller, opening a call or continuing `call`; end hangs `call` up |
| `text` | text |  | `say`: what the caller says |
| `call` | text |  | the call to continue or end; a new call opens when left out |
| `agent` | text |  | the agent's name; the only one held when left out |
| `contact` | text |  | who is calling (a phone number), so memory files the call under them |
| `state` | an object |  | the state a new call opens in |

```json title="called with"
{
  "action": "say",
  "text": "Hi, this is Ana Ruiz. My order A-1042 arrived broken, please tell the manager.",
  "contact": "+15550100142"
}
```

```json title="answered"
{
  "call": "call_ca0bf3567bf84a528071f482b43c4a92",
  "heard": [
    {
      "state": {
        "stage": "ask"
      }
    },
    {
      "tool": "takeMessage",
      "args": {
        "name": "***",
        "about": "Order A-1042 arrived broken"
      }
    },
    {
      "state": {
        "stage": "ask",
        "message": {
          "name": "***",
          "about": "Order A-1042 arrived broken"
        }
      }
    },
    "… 3 more"
  ],
  "ended": false,
  "version": 1
}
```

## `prompt`

Print the exact prompt the model reads when a call opens, or in a given state: offline, no key, no call.

`prompt` prints what the model reads — the class's docstring, the rules, the tools, the view — exactly as a call would send it, offline. `state` sets fields first, so you can read the prompt at any stage. A Ruby agent's prompt is `pinecall prompt` in a terminal.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `state` | an object |  | fields of the class and their values, to see the prompt in that state |
| `channel` | `phone` · `web` · `whatsapp` |  | the channel the prompt is written for |

```json title="called with"
{
  "state": {
    "stage": "done",
    "message": {
      "name": "Ana Ruiz",
      "about": "a broken order"
    }
  }
}
```

```json title="answered"
{
  "agent": "front-desk",
  "prompt": "(below)"
}
```

```text title="prompt"
── identity (static) ──
You answer the phone for the business. Short sentences: everything you say is read aloud. You answer what the business's documents say. For anything else you take a message: who is calling and what it is about. You never promise when they will hear back.

<rules>
- Invent nothing: if it did not come from a tool or from the knowledge, do not say it.
- One question per turn, and wait for the answer.
- Answer in the language the caller speaks.
</rules>

<protocols>
- To act, call a tool; saying you have done something does not do it.
- Before an irreversible action read back what you are about to do and wait for an explicit yes.
- If you cannot solve it, say so and offer to hand over to a person.
</protocols>

<channel>
You are on a phone call. Everything you write is read aloud by a voice: short spoken sentences, no lists, no bold, no symbols, no links. Say an email or a web address the way a person says it out loud.
</channel>

── knowledge (static) ──

── tools (static) ──
<tools>
- takeMessage: Writes down the caller's message. Call it as soon as the caller has said their name and what the call is about, in that same turn and without reading it back first; never with a blank or a guess.
</tools>

── history ──

── view (dynamic) ──
The message is written down: Ana Ruiz, about a broken order. Tell them it reached the team, say goodbye and hang up.
```

## `console_url`

A link that opens the console signed in, on the org's floor or on one agent: good for five minutes, once.

`console_url` answers a link for the person to open: the console signed in, its calls with every turn and verdict, its settings, a playground to talk to the agent by voice. The link carries a one-use code that dies in five minutes; it is the one value no answer hides.

| parameter | takes | | what it is |
|---|---|---|---|
| `agent` | text |  | open on this agent's screens; the org's floor when left out |
| `prod` | true or false |  | act in production instead of the sandbox; only a server installed with `pinecall mcp install --prod` may, and the org's own switch still decides |

```json title="called with"
{
  "agent": "front-desk"
}
```

```json title="answered"
{
  "url": "https://cloud.pinecall.io/sandbox/a/front-desk?login=lc_…",
  "expires": "five minutes, one use"
}
```
