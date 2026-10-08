# Changelog

All notable changes to `pinecall`, the CLI. Up to 0.9 it shipped inside the framework's package;
that history is [`@pinecall/agents`'s CHANGELOG](https://github.com/pinecall/agents/blob/main/CHANGELOG.md).
The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `pinecall test --case <name>` (repeatable) plays cases of the org's dataset by name, a pending one too; `--dataset` plays every approved case; with either and no paths, only the cases run and `test/goldens` is not needed. `--version n` runs every call on that version of the agent's settings. A golden's `expect` takes `judges`: hang-up judges asked again by name.
- `pinecall cases`: the org's dataset, real calls kept as cases — the inbox (`--status`), `show` one whole with the commands that come next, `approve`, `dismiss` (`--judge-was-wrong <judge>`, `--note`), `reopen`, `pull` its golden into `test/<agent>/goldens/` and mark it kept in the repository, `keep <call> --name x` a finished call, `forget` one. A case is named within the agent.

### Changed

- `pinecall runs promote` writes the golden the gateway derives from the call (`GET /v1/calls/{call}/golden`), so a candidate now carries the facts the app gave the call, what memory recalled and the day it ran, and every broken judge lands in its `expect` (`judges` by name). A call nobody judged is no longer refused: its expect is empty, to be written by hand.

## [0.9.37] — the desk, as an MCP tool

### Added

- `pinecall mcp` has `supervise`: the desk `pinecall supervise` is in a terminal, for an assistant. `watch` reads a live call since a cursor — the caller, the agent, its tool calls, every move of a desk, the end — waiting up to `wait_s` for more; `whisper`, `say`, `takeover`, `release`, `transfer` and `end` move it, each landing in the call's log as a `supervisor.*` entry. An ended call is refused.

## [0.9.36] — an assistant's agent runs before anything is installed

### Added

- `pinecall mcp`: a TypeScript project with nothing installed runs anyway. `start` and `prompt` lend the agent's thread the `@pinecall/agents` the server ships — nothing is written into the project — until `npm install` pins the project's own; `status` says `framework` while it is lent. So an assistant goes from an empty folder to an agent answering without a terminal. Every CLI verb still refuses such a project by name.

## [0.9.35] — no Claude Haiku 4.5 left

### Changed

- `pinecall agent --help`, the CLI's pages and the MCP's examples name `claude-haiku-5-5` where they named `claude-haiku-4-5`; the sample call in `sessions` is priced at Claude Haiku 5.5's rates.

## [0.9.34] — every MCP tool documented: its parameters and a real call

### Added

- The MCP's tools each have a reference: every parameter, read off the tool's own schema, and one real call answered by Pinecall Cloud — `docs/mcp/`, eight pages by stage, written by `scripts/mcp-pages` and failed by a test when they drift. Every `action` now says what each of its values does, in the schema the assistant reads.

## [0.9.33] — `haiku` is Claude Haiku 5.5

### Changed

- The `haiku` tier (`pinecall test --model haiku`, `pinecall agent set --llm haiku`, the nightly's baseline column) expands to `claude-haiku-5-5`, not `claude-haiku-4-5-20251001`. A setting stored before keeps the id it was stored with.

## [0.9.32] — `pinecall generate`

### Added

- `pinecall generate` (`g` for short): `agent <name>` writes a second agent into the project from the templates `new` writes, in the project's language; `golden <name> --input '…' --tool …` writes a golden from the caller's lines and the tools that must be called. Never over a file. The MCP's `project` tool does the same with `generate`.

## [0.9.31] — `memory forget` asks for `--yes` where nobody can be asked

### Changed

- `pinecall memory forget` with nobody at a terminal erases only with `--yes`, as `pinecall data erase` does; before, a script erased without asking. `--yes` also skips the question on a terminal.

## [0.9.30] — the MCP reviewed against the plan: `prod` honoured, `simulate` waits, one packet-loss unit

### Changed

- `pinecall simulate --packet-loss` takes the share of the caller's packets lost, from 0 to 1, as `pinecall test --voice` does and as the wire carries it; a percent is refused. The console's Simulations screen still says a percent.
- `pinecall mcp`: every tool that opens the project's door takes `prod: true`, honoured by a server installed with `--prod` and refused by any other — before, `--prod` changed nothing. `simulate` runs as `test` does (`run`, then `wait` past `wait_s`, with the transcript so far); a second `test run` or `simulate run` on an agent with one in flight is refused. `docs list`, `docs attached` and `memory show` name no agent, so a project of two needs none; `memory policy` reads the two lists, not the whole settings. `start` attaches to the agent's own process, never to the companion a terminal keeps beside it; a save landing as `stop` runs is dropped, so nothing runs after it; `project open` is refused while an agent is held. Each tool's manual rides its description, and the instructions name the tools by stage instead of repeating them. One line per call on stderr: the tool, the time, ok or refused.

## [0.9.29] — the console reaches the agent an assistant holds

### Added

- An agent `pinecall mcp`'s `start` holds in a thread has a companion beside it, as `pinecall start` does: the console's Chat, Tests, Simulations, Docs and Memory screens reach it. `pinecall agent list` shows it as `pinecall-mcp/<version>`.

## [0.9.28] — every tool of the MCP

### Added

- `pinecall mcp` holds the agent and does all of it from an assistant: 35 tools. `start`, `stop`, `status` and `logs` hold a TypeScript agent in a worker thread of the server — no process — reloaded on every save (a save that does not load keeps the version before answering, and says why), or attach to a Ruby agent or a terminal already holding it; `chat` talks to it a line at a time, each answered whole; `prompt` and `console_url`. `agent`, `calls`, `call`, `pipeline`, `providers`, `voices`, `voice_sample`, `line`, `numbers` (import as a dry run first), `carriers`, `callbacks`, `lexicon`. `test` (a column per model, written or spoken), `runs` (list, show, diff, promote, drift), `simulate`, `personas`, `judges`, `eval`, `docs`, `memory`, `remember`. `deploy` and its family. `docs_search` and `get_doc` over docs.pinecall.io. No tool takes a secret, and none erases anything.

### Changed

- `pinecall deploy` packs what the project's `.gitignore` files leave in, read where each sits, and no longer asks git: a folder that is no checkout packs the same.

## [0.9.27] — Claude Desktop finds node

### Fixed

- `pinecall mcp install` gives Claude Desktop the folder of this machine's `node` on its `PATH`: a desktop app starts without the shell's, so under nvm `npx` could not find `node` and the server never started.

## [0.9.26] — mcp install names the newest CLI

### Fixed

- `pinecall mcp install` writes `npx -y pinecall@latest mcp`: inside a project that pinned an older `pinecall`, the bare name ran that copy, which has no `mcp`, and the assistant only saw the connection close.

## [0.9.25] — the CLI as an MCP server

### Added

- `pinecall mcp`: the CLI as an MCP server for Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Antigravity and Gemini CLI, with its first tools — `whoami`, `login`, `link`, `project` — acting in the sandbox, starting no process, and scrubbing every key from what they answer. `pinecall mcp install` writes it into every assistant on the machine (`--list`, `--remove`, `--prod`).

## [0.9.24] — `pipeline` reads talk_share as a share

### Fixed

- `pinecall pipeline` prints `talk_share` as a percent, not in seconds.
- `pinecall judges --help` and the CLI's page name every platform judge name the gateway reserves (`identified`, `disclosed`, `honoured_stop` and `heard` beside `consent`, `grounded`, `promises`, `persona`).

## [0.9.23] — `--version`, and help that says what the runtime answers

### Added

- `pinecall --version` (`-v`, `version`) prints the CLI's version.

### Fixed

- `pinecall eval --help` names the six checks the runtime runs and their verdicts (held · broken · deferred · skipped), and its `--policy` example uses keys the runtime reads; the old `llm_ttft` matched nothing and silently skipped the latency check.
- `pinecall callbacks` says `via the agent` for a call back the agent's own tool promised, instead of `via the widget`.
- Help and messages say Pinecall where they said "the box".

## [0.9.22] — `pinecall new`, and every verb walked on what it makes

### Added

- **`pinecall new <name> [--ruby]`**: a project of one agent, in TypeScript or Ruby, ready for
  `link`, `prompt`, `chat`, `test`, `start` and `deploy`.
- **The quickstart** (`docs/quickstart.md`): nothing to an agent that answers, in ten minutes.

### Changed

- **`pinecall prompt` needs no `--state`**: without one it prints the page a call opens on.
- **`pinecall deploy` refuses a Ruby project** by name, rather than asking it to `npm i` packages it
  cannot use: the box runs TypeScript projects, and a Ruby agent runs `pinecall start` on its own
  server.

### Fixed

- **`pinecall chat` with piped input answers every line.** Two lines sent at once hung up after the
  first answer; it waits for each line to be heard and answered.
- **`pinecall chat` hangs up through the gateway**, which ends the call before closing the socket,
  so the agent's process no longer says it kept a live call. A pipe gets no `‹` prompts.

## [0.9.21] — the serve entry is the project's own framework

### Fixed

- **A TypeScript agent is served only by the framework its project installs.** The serve entry was
  resolved the way Node resolves a module, which reads `NODE_PATH` too: under pnpm that is pnpm's
  store, so a project with no `@pinecall/agents` of its own was served by whatever the store held.
  It is looked for in the project's `node_modules` and the folders above it, and nowhere else.

## [0.9.20] — the CLI, a package of its own

### Fixed

- **A member's first `agent set` (and `lexicon`, `agent knowledge edit`, `docs attach`) is no
  longer refused with "this corner is at v0 now".** The write was guarded by the version of the
  team's corner it was read through, while the gateway writes the person's own, still empty. The
  guard is now the version of the corner the write lands on (0 when it is empty): a person's own
  in the sandbox, the org's for a server's token and in production. The line that follows names
  that corner, "your corner", where it said "the team's corner".

### Changed

- **Breaking: the CLI is a package of its own.** `pinecall` on npm is the CLI alone, and the
  framework is `@pinecall/agents`. The CLI never loads a class: it starts the project's own serve
  entry — `@pinecall/agents/serve`, resolved from the project's root, or the `pinecall` gem's
  `Pinecall::Serve` — so a TypeScript project depends on both, and one CLI serves a Ruby project too.
  A TypeScript project that does not install `@pinecall/agents` is refused by name.
- **Breaking: `pinecall deploy` refuses a project whose `package.json` lists `pinecall` or
  `@pinecall/agents` nowhere in `dependencies`**, before it sends anything: the box starts the
  project's own `pinecall start`.
- The CLI's earlier changes since 0.9.19 — `start` in a process of its own with a companion socket,
  `call.started.state`, an agent's slug as its folder's name — are under Unreleased in
  `@pinecall/agents`'s CHANGELOG.
