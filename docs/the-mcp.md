# The MCP server

`pinecall mcp` is the same CLI as an [MCP](https://modelcontextprotocol.io) server: an assistant —
Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Antigravity, Gemini CLI — launches it, and its
tools take a person from an empty folder to an agent on Pinecall without a terminal.

The server starts no process of its own: what needs a browser, an editor or a speaker hands the
link, the text or the file back instead. Every tool acts in the **sandbox** unless it says `prod`
(below). No tool takes a vendor key, a carrier secret or an app's secret, and no answer carries a
Pinecall key: every answer and every refusal is scrubbed before it reaches the model. The server
writes one line per call to its stderr — the tool, how long it took, whether it answered or
refused, never what it was asked or what it answered — which the assistant keeps in its own log.

## Install

```bash
npm i -g pinecall
pinecall mcp install
```

`install` writes one entry into every assistant installed on this machine — `npx -y pinecall@latest mcp`,
the newest published CLI, whatever a project pins — replacing an older Pinecall entry, copying each file beside itself as `.bak` first, and leaving
every other server, setting and comment in it as it was. Restart the assistant afterwards: it read
its config when it started. No key is written anywhere: the server reads the open project's
`.env`, and the `login` tool signs the machine in.

| flag | what it does |
|---|---|
| `--list` | every assistant, whether it is installed, and whether Pinecall is in it; changes nothing |
| `--remove` | takes Pinecall out of every assistant |
| `--prod` | writes `--prod` into each entry, so a tool asked with `prod: true` acts in production; your org's switch still decides |

| assistant | file |
|---|---|
| Claude Code | `~/.claude.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `~/.config/Claude/…` (Linux), `%APPDATA%\Claude\…` (Windows) |
| Codex | `~/.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |

Claude Desktop is launched without the shell's `PATH`, so its entry names `npx` by its full path and
puts the folder of this machine's `node` on the `PATH` it gives the server.

## The project

Every tool acts on one project folder — the one that holds `agents/`: the root the assistant
declares, else the folder the server was started in, else the one `project open` named. Its key is
the one `pinecall` itself reads: `PINECALL_KEY` from the environment, else from the project's `.env`.

## The tools

Every tool acts in the sandbox. The tools that open the project's door take `prod: true` to act
in production instead: a server installed with `--prod` does, and any other refuses it in one
sentence that names the flag. The tools that act on the agent held (`chat`, `test`, `simulate`,
`remember`) follow the world it was started in. A long one (`login`, `test`, `simulate`,
`deploy`) answers within `wait_s` seconds (25 unless asked, at most 50) with what it has and says
how to keep waiting, so no host gives up on it.

The assistant reads each tool's sentence and its manual in the tool list; the server's instructions
carry the journey and the tools by stage, so nothing is said twice.

### Getting started

Every parameter, and a real call of each: [Getting started](mcp/getting-started.md).

| tool | actions | what it does |
|---|---|---|
| `whoami` | — | which org, gateway and environment the project's key acts in, and whether production is allowed for the key and for this server |
| `login` | `start` · `status` | signs this machine in: `start` answers a link the person opens in a browser; `status` waits until they approved it. The key is kept in `~/.pinecall/session.json` and never answered |
| `link` | `orgs` · `write` | the person's orgs, and the key of one written into the project's `.env` (`PINECALL_KEY`, and `PINECALL_URL` when the gateway is not Pinecall Cloud); it warns when `.gitignore` does not name `.env` |
| `project` | `show` · `open` · `new` · `generate` | the folder the tools act on, its agents and their language, whether it has a key; another folder opened (with nothing held: `stop` first); a new project of one agent written from `pinecall new`'s templates, in TypeScript or Ruby, and opened; `generate` adds a second agent (`kind: agent`) or a golden from the caller's lines and the tools that must be called (`kind: golden`), as `pinecall generate` does |

### Holding the agent, and talking to it

Every parameter, and a real call of each: [Holding the agent, and talking to it](mcp/holding-and-talking.md).

| tool | actions | what it does |
|---|---|---|
| `start` | — | holds the agent as `pinecall start` does, in the sandbox or, with `prod`, in production. A TypeScript agent runs in a worker thread of this server — no process — and reloads on every save; a project with nothing installed runs on the `@pinecall/agents` this server ships, lent to the agent's thread alone — nothing is written into the project — until `npm install` pins the project's own: the new version registers before the old one drains, a save that does not load keeps the version before answering. A Ruby agent, or one a terminal already holds, is attached to — the agent's own process, never the companion beside it. Beside the thread a companion answers the console, so its Chat, Tests, Simulations, Docs and Memory screens reach the agent the assistant holds; `pinecall agent list` shows it as `pinecall-mcp/<version>` |
| `stop` | — | drains the thread and lets the agent go; an attached process is left running |
| `status` | — | each agent held, how (`thread` or `attached`), its app, the version answering, the sentence a broken save was refused with, and `framework` while the agent runs on the one the server lent the project |
| `logs` | — | the last lines the agent printed: its own output, a load error, the versions as they replace each other |
| `chat` | `say` · `end` | a written call with the agent held: each line answered whole — its turns, the tools it called with their arguments and results, the state it changed. `call` continues one, `contact` makes the caller someone, `state` opens it in a state |
| `prompt` | — | the exact prompt a state produces, offline (TypeScript; Ruby's is `pinecall prompt`) |
| `console_url` | — | a link that opens the sandbox's console signed in, once, within five minutes: the one value no answer hides |

### The agent's settings

Every parameter, and a real call of each: [The agent's settings](mcp/settings.md).

| tool | actions | what it does |
|---|---|---|
| `agent` | `show` · `set` · `clear` · `history` · `diff` · `rollback` · `knowledge` | the agent's settings — voice, models, language, greeting, turn-taking, recording, memory policy — each change a version, checked as `pinecall agent set` checks it; `knowledge` reads or writes what it knows by heart |
| `lexicon` | `show` · `add` · `hear` · `rm` · `history` | how the voice says a word, and the words the ears must catch |
| `voices` | — | a vendor's voices in a language, the id first |
| `voice_sample` | — | a line said by the gateway in a voice, saved as a WAV under `.pinecall/voices/`, with its timings |

### Calls, and what they run on

Every parameter, and a real call of each: [Calls, and what they run on](mcp/calls.md).

| tool | actions | what it does |
|---|---|---|
| `calls` | — | the agent's newest calls, with their ids, how they ended, their cost and verdicts |
| `call` | — | one call's log, entry by entry, paged by `after`, narrowed by `types` |
| `pipeline` | — | the vendors and models the agent hears, decides and speaks with, and their latency |
| `providers` | — | every vendor the gateway can run and whose key a call would use; never a key |

### The phone

Every parameter, and a real call of each: [The phone](mcp/phone.md).

| tool | actions | what it does |
|---|---|---|
| `line` | `show` · `from` · `forget` · `claim` · `release` | whose process a ring lands in, and the person's own phone |
| `numbers` | `list` · `available` · `import` | the org's numbers; what its carrier account owns; an import, shown as steps first (`dry_run` is the default) |
| `carriers` | `list` · `show` | the org's carrier accounts; adding one takes secrets, so it is a terminal's |
| `callbacks` | — | the people waiting for a call back |

### Testing

Every parameter, and a real call of each: [Testing](mcp/testing.md).

| tool | actions | what it does |
|---|---|---|
| `test` | `run` · `wait` | the goldens through the agent held, a column per model in `models`, written or spoken (`voice`, `background_noise`, `packet_loss` 0..1): the matrix, each call's latency, a reproduction for each golden that broke. One run per agent at a time |
| `runs` | `list` · `show` · `diff` · `promote` · `drift` | the suites kept, what moved between two, a real call written as a golden candidate under `test/candidates/`, each judge's drift |
| `simulate` | `run` · `wait` | a persona's call against the agent held, the conversation and every judge's verdict; past `wait_s`, the transcript so far, and `wait` picks the rest up. One per agent at a time |
| `personas` | `list` · `show` · `add` · `edit` · `rm` | the callers a model plays: a goal, a manner, facts, a rule for hanging up satisfied |
| `judges` | `list` · `add` · `rm` | your own questions asked of the agent's calls, or every agent's with `org` |
| `eval` | — | one finished call checked again by code, with `banned` words and a latency `budget` |

### Knowledge and memory

Every parameter, and a real call of each: [Knowledge and memory](mcp/knowledge-and-memory.md).

| tool | actions | what it does |
|---|---|---|
| `docs` | `push` · `list` · `eval` · `attach` · `detach` · `attached` | a folder pushed as a base, attached to the agent, held to `goldens/docs.json`; `list` and `attached` are the org's and name no agent |
| `memory` | `show` · `policy` · `eval` | what the agent kept about a caller (naming no agent), what it keeps and never keeps (`policy` with neither list reads them), and `goldens/memory.json` |
| `remember` | — | the extraction cases under `test/<agent>/memory/`, run through the agent held |

### Going live, and the docs

Every parameter, and a real call of each: [Going live, and the docs](mcp/going-live.md).

| tool | actions | what it does |
|---|---|---|
| `deploy` | `deploy` · `wait` · `list` · `releases` · `logs` · `rollback` · `stop` · `start` | the project run on Pinecall: a release uploaded (what its `.gitignore` files leave in) and followed until live; TypeScript projects only |
| `docs_search` | — | the sections of docs.pinecall.io that answer a question, each with its address |
| `get_doc` | — | one page of the docs whole, by its address or its path |

A refusal is one sentence that names what to do next: no project names `project`, no key names
`link`, no sign-in names `login`, no agent held names `start`.

## Not in the MCP

What cannot be undone is never a tool: erasing data, forgetting a contact, dropping a base, a number
or a carrier, removing a deployed app. Neither is anything that takes a secret. Those stay
`pinecall` verbs a person types.
