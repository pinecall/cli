# Changelog

All notable changes to `pinecall`, the CLI. Up to 0.9 it shipped inside the framework's package;
that history is [`@pinecall/agents`'s CHANGELOG](https://github.com/pinecall/agents/blob/main/CHANGELOG.md).
The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
