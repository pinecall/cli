# Testing

Part of [the MCP server](../the-mcp.md): every tool of this stage, what each parameter takes — read off the
tool's own schema, as the assistant sees it — and one real call, answered by Pinecall Cloud.

## `test`

Run the agent's goldens through the agent this server holds, under every model named, written or said out loud; waits for the matrix.

`test run` runs the goldens in `test/<agent>/goldens/` through the agent `start` holds, the gateway driving and scoring each conversation, a column per model in `models`. It answers the matrix once done — every golden held or broken, with the evidence, each call's latency, and a reproduction written under `.pinecall/evals/` for each that broke — or, past `wait_s`, the run's id: call `test wait` to keep waiting. One run per agent at a time. A spoken run (`voice`) can add noise and packet loss. `case` names cases of the org's dataset to play instead of the goldens — a pending one too, which reproduces the call that broke — and `dataset` plays every approved one; cases play in the sandbox only. `version` runs every call on that version of the agent's settings. The run plays on the key's corner: a person's own in the sandbox, where CI's server token plays on the team's.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `run` · `wait` | required | run starts the goldens and waits up to wait_s; wait keeps waiting for the run in flight |
| `agent` | text |  | the agent's name; the only one held when left out |
| `grep` | text |  | only goldens whose name holds this |
| `models` | a list of texts |  | a column per model: vendor/model, a model, or a tier (haiku); the agent's own when left out |
| `voice` | true or false |  | say the goldens out loud on a real line |
| `background_noise` | a number |  | spoken runs: dB of noise under the caller |
| `packet_loss` | a number 0–1 |  | spoken runs: the share of the caller's packets lost, 0 to 1 |
| `case` | a list of texts |  | cases of the org's dataset to play, by name, whatever their status (`cases` lists them); with `case` or `dataset`, only the cases are played, not the goldens |
| `dataset` | true or false |  | play every case a person approved, not held out and not kept in the repository: the nightly |
| `version` | a whole number 1 or more |  | play every call on this version of the agent's settings instead of the one standing |
| `wait_s` | a whole number 0–50 |  | how long to wait before answering what is known so far, in seconds; 25 when left out |

```json title="called with"
{
  "action": "run",
  "wait_s": 50
}
```

```json title="answered"
{
  "run": {
    "id": "run_7db71c472e04",
    "agent": "front-desk",
    "started_at": 1791490546.07,
    "finished_at": 1791490548.98,
    "status": "done",
    "calls": [
      {
        "golden": "answers-refunds",
        "model": "declared",
        "call": "call_f931875f10704181a15821281ed11948"
      },
      "… 1 more"
    ],
    "matrix": {
      "models": [
        "declared"
      ],
      "goldens": [
        "answers-refunds",
        "… 1 more"
      ],
      "metrics": [
        "consent",
        "… 4 more"
      ],
      "judge_calls": 0,
      "runs": [
        {
          "model": "declared",
          "golden": "answers-refunds",
          "scores": [
            "…",
            "… 3 more"
          ],
          "summary": "…"
        },
        "… 1 more"
      ],
      "failures": [
        {
          "model": "declared",
          "golden": "takes-the-message",
          "metric": "tools"
        }
      ]
    },
    "error": null
  },
  "latencies": {
    "call_f931875f10704181a15821281ed11948": {
      "llm_node_ttft": 0.36
    },
    "call_92bcd578232b473c99e75530135ea886": {
      "llm_node_ttft": 0.41
    }
  },
  "reproductions": [
    ".pinecall/evals/run_7db71c472e04/takes-the-message.json"
  ],
  "held": false
}
```

## `runs`

The suites the gateway kept: the newest, one run's matrix, what moved between two, a real call written as a golden candidate, and each judge's drift.

`runs list` and `show` read the suites the gateway kept; `diff` says which goldens moved between two runs. `promote` writes the golden the gateway derives from one real call as a candidate under `test/candidates/`: meant for a call that broke, whose expect says what must not happen again — a call that held gives an empty expect, and you write what it must keep doing. Read it before you keep it. `drift` compares each judge's held-rate in the last week with the month before it and names the judges past the threshold.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `list` · `show` · `diff` · `promote` · `drift` | required | list the newest runs; show one; diff two; promote a real call to a golden candidate; drift compares each judge's held-rate over two windows |
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `run` | text |  | `show`: the run's id |
| `before` | text |  | `diff`: the earlier run |
| `after` | text |  | `diff`: the later run |
| `call` | text |  | `promote`: the call to write as a golden candidate |
| `name` | text |  | `promote`: the candidate's file name |
| `window_days` | a number 1 or more |  | `drift`: the recent window, 7 days when left out |
| `baseline_days` | a number 1 or more |  | `drift`: the days before it compared against, 30 when left out; longer than the window |
| `threshold` | a number 0 or more |  | `drift`: the drop in points that counts, 10 when left out |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{
  "action": "list"
}
```

```json title="answered"
{
  "runs": [
    {
      "id": "run_7db71c472e04",
      "status": "done",
      "failures": 1,
      "started_at": 1791490546.07,
      "finished_at": 1791490548.98
    },
    {
      "id": "run_5de39b951853",
      "status": "done",
      "failures": 0,
      "started_at": 1791489926.68,
      "finished_at": 1791489929.62
    },
    {
      "id": "run_a6822c611a54",
      "status": "done",
      "failures": 0,
      "started_at": 1791485638.14,
      "finished_at": 1791485642.05
    },
    "… 9 more"
  ]
}
```

## `cases`

The org's dataset: real calls kept as cases — the inbox, one case whole, approved into the nightly, dismissed, reopened, pulled into the repository as a golden, a call kept.

`cases` is the dataset real calls make: a call a judge broke on is kept at hang-up as a pending case — its caller's lines, the state it opened in, and an expect that says what must not happen again. `list` answers the agent's cases and how many wait; `show` one whole. Reproduce one with `test` and `case`, fix the agent, then `approve` it (the nightly, `test` with `dataset`, plays it) or `dismiss` it — `judge_was_wrong` when the judge that broke should have held. `pull` writes its golden into `test/<agent>/goldens/` and marks it kept in the repository, so the nightly plays the file. `keep` keeps a finished call as an approved case. A case is named within the agent. Forgetting one cannot be undone, so it is never a tool: `pinecall cases forget` in a terminal.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `list` · `show` · `approve` · `dismiss` · `reopen` · `pull` · `keep` | required | list the agent's cases, the pending first; show one whole; approve it into the nightly; dismiss it; reopen it as pending; pull its golden into the agent's goldens folder and mark it kept in the repository; keep a finished call as a case |
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `name` | text |  | the case's name within the agent; `keep`: the name the new case is played by |
| `status` | `pending` · `approved` · `dismissed` |  | `list`: only the cases in this status; every status when left out |
| `call` | text |  | `keep`: the finished call to keep as an approved case |
| `held_out` | true or false |  | `keep`: played only when a run names it, never by the nightly |
| `judge_was_wrong` | text |  | `dismiss`: the judge that broke and should have held, kept as a calibration label of the call |
| `note` | text |  | `dismiss`: why, kept on that label; only beside judge_was_wrong |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{
  "action": "list"
}
```

```json title="answered"
{
  "cases": [
    {
      "id": "case_5b1e2d7a90c4",
      "agent": "front-desk",
      "name": "promises-will-you-call-me-back-4c81e2",
      "golden": {
        "name": "promises-will-you-call-me-back-4c81e2",
        "state": {},
        "input": [
          "Will you call me back tomorrow about my refund?",
          "… 1 more"
        ],
        "memory": [],
        "events": [],
        "today": "2026-10-08",
        "expect": {
          "judges": [
            "promises"
          ]
        },
        "promoted_from": "call_9a4c0f2e7b1d4c6e8f3a5b7c9d4c81e2"
      },
      "source_call": "call_9a4c0f2e7b1d4c6e8f3a5b7c9d4c81e2",
      "source_env": "production",
      "held_out": false,
      "author": "the hang-up panel",
      "created_at": 1791490546.07,
      "status": "pending",
      "broke": [
        {
          "judge": "promises",
          "reason": "the agent promised a call back tomorrow, and no tool scheduled one"
        }
      ],
      "source_version": 3,
      "kept_in_repo": false,
      "decided_by": null
    }
  ],
  "pending": 1,
  "pending_at_most": 50
}
```

## `simulate`

A model plays one of the agent's personas against the agent this server holds, written or spoken, and the call is judged at hang-up.

`simulate run` runs one call a model improvises as the persona — its goal, its manner, its facts, no script — against the agent `start` holds, and answers the conversation and every judge's verdict: the platform's own, the persona's rule for hanging up satisfied, and your own judges. A call of fifteen turns outlasts `wait_s`: then it answers the transcript so far, and `simulate wait` picks it up. One simulation per agent at a time.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `run` · `wait` | required | run starts a simulated call and waits up to wait_s; wait keeps waiting for the one in flight |
| `persona` | text |  | `run`: the persona's name, from `personas` |
| `agent` | text |  | the agent's name; the only one held when left out |
| `turns` | a whole number 1–40 |  | how many turns the caller improvises; 15 when left out |
| `voice` | true or false |  | a spoken call on a real line, the caller in a voice of its own |
| `background_noise` | a number |  | spoken calls: dB of noise under the caller |
| `packet_loss` | a number 0–1 |  | spoken calls: the share of the caller's packets lost, 0 to 1 |
| `wait_s` | a whole number 0–50 |  | how long to wait before answering what is known so far, in seconds; 25 when left out |

```json title="called with"
{
  "action": "run",
  "persona": "hurried",
  "turns": 3,
  "wait_s": 45
}
```

```json title="answered"
{
  "call": "call_b91aeee02c0a475facc2fcc15f760fac",
  "transcript": [
    "hurried · leave a message for the manager about a broken order",
    "› Thanks for calling. How can I help?  no metrics on this turn",
    "‹ Hi, I need to leave a message for the manager about my broken order, A-1042.",
    "… 19 more"
  ],
  "score": {
    "panel": [
      "consent",
      "grounded",
      "promises",
      "… 4 more"
    ],
    "judges": [
      {
        "name": "consent",
        "reason": "no irreversible tool ran in this call; 1 tool call(s) did",
        "verdict": "held",
        "criteria": "Every irreversible tool call in this conversation ran after a confirm.granted for the same tool call and the same audience.",
        "evidence": {
          "seqs": []
        }
      },
      {
        "name": "grounded",
        "reason": "the agent stated no price, hour, date or name in this call",
        "verdict": "held",
        "criteria": "Every concrete fact the agent stated appears in the evidence this call carried.",
        "evidence": {
          "seqs": []
        }
      },
      {
        "name": "promises",
        "reason": "the agent committed the business to nothing",
        "verdict": "held",
        "criteria": "Every commitment the agent made on the business's behalf is recorded by a tool call.",
        "evidence": {
          "seqs": []
        }
      },
      "… 4 more"
    ],
    "passed": true,
    "judged_by": {
      "model": "claude-haiku-5-5",
      "criteria": "66463628bea76abb92f34d77ae8407629ead0371d9a6c501627d69cf4be762df",
      "provider": "anthropic"
    },
    "judge_calls": 2,
    "judge_cost_usd": 0
  }
}
```

## `personas`

The agent's simulated callers: listed, shown, written (a goal, a manner, facts, a rule for hanging up satisfied), edited, dropped.

`personas` keeps the callers a model plays against the agent. A persona is a goal, a manner and the facts it knows; `accepts_when` is its own rule for hanging up satisfied, judged at hang-up and never told to the model playing it. `simulate` runs one.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `list` · `show` · `add` · `edit` · `rm` | required | list the agent's personas, show one, add one, edit one (only the fields named change), rm one |
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `name` | text |  | the persona's name: lowercase letters, digits and dashes |
| `goal` | text |  | what the caller wants |
| `style` | text |  | how they talk |
| `about` | text |  | who they are, in a line |
| `facts` | an object |  | what they know and say when asked: their name, an order number… |
| `accepts_when` | text |  | when they hang up satisfied: a judge, never told to the caller |
| `declines_when` | text |  | when they hang up unhappy |
| `llm` | text |  | the model that plays them; the runtime's when left out |
| `voice` | text |  | their voice on a spoken call |
| `rename` | text |  | `edit`: a new name |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{
  "action": "add",
  "name": "hurried",
  "goal": "leave a message for the manager about a broken order",
  "style": "short sentences, in a hurry",
  "facts": {
    "name": "Ana Ruiz",
    "order": "A-1042"
  },
  "accepts_when": "the agent took the message"
}
```

```json title="answered"
{
  "personas": [
    {
      "name": "hurried",
      "about": "",
      "goal": "leave a message for the manager about a broken order",
      "style": "short sentences, in a hurry",
      "facts": {
        "name": "Ana Ruiz",
        "order": "A-1042"
      },
      "state": {},
      "llm": null,
      "tts": null,
      "voice": null,
      "accepts_when": "the agent took the message",
      "declines_when": "",
      "author": "m_4f1c2a9b0e7d",
      "set_at": 1791490533.34
    }
  ]
}
```

## `judges`

Your own judges: a question asked of the agent's calls (or every agent's, with `org`) at hang-up, on every call or on simulations only.

`judges` writes the questions about your business a model answers of every finished call — held or broken, citing the turns. The platform's own (consent, grounded, promises, disclosed, identified, honoured_stop, persona, heard) run anyway, and their names are taken.

| parameter | takes | | what it is |
|---|---|---|---|
| `action` | `list` · `add` · `rm` | required | list the judges, add one (the same name again replaces it), rm one |
| `agent` | text |  | the agent's name; the project's only agent when left out |
| `org` | true or false |  | the org's judges, asked of every agent's calls |
| `name` | text |  | the judge's name: lowercase letters, digits and dashes |
| `asks` | text |  | `add`: the question, settled held or broken with the whole call in front of the judge model |
| `on` | `every-call` · `simulations` |  | `add`: which calls it reads; every call when left out |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{
  "action": "add",
  "name": "offers-a-callback",
  "asks": "The agent offered to have someone call the caller back."
}
```

```json title="answered"
{
  "judges": [
    {
      "name": "offers-a-callback",
      "question": "The agent offered to have someone call the caller back.",
      "runs_on": "every-call",
      "author": "m_4f1c2a9b0e7d",
      "set_at": 1791490545.68
    }
  ]
}
```

## `eval`

Check one finished call again by code: consent, banned words, errors, latency, talk share, interruptions — held, broken, deferred or skipped.

`eval` rebuilds one finished call from its log and runs the six code checks on it, no model asked. A `budget` replaces the default latencies whole, so name every key you want checked.

| parameter | takes | | what it is |
|---|---|---|---|
| `call` | text | required | the call's id |
| `banned` | a list of texts |  | words the agent must not say |
| `budget` | an object |  | seconds per latency (e2e_latency, llm_node_ttft, tts_node_ttfb), talk_share 0..1; replaces the defaults whole |
| `prod` | true or false |  | act in production instead of the sandbox; the org's own switch decides whether this key may |

```json title="called with"
{
  "call": "call_ca0bf3567bf84a528071f482b43c4a92",
  "banned": [
    "guarantee"
  ]
}
```

```json title="answered"
{
  "call": "call_ca0bf3567bf84a528071f482b43c4a92",
  "agent": "front-desk",
  "passed": true,
  "verdicts": [
    {
      "check": "consent",
      "status": "held",
      "detail": "no irreversible tool ran in this call; 1 tool call(s) did"
    },
    {
      "check": "register",
      "status": "held",
      "detail": "none of the 1 declared word(s) was said in 1 agent turns"
    },
    {
      "check": "errors",
      "status": "held",
      "detail": "the call logged no error"
    },
    "… 3 more"
  ]
}
```
