# Changelog

All notable changes to `pinecall`, the CLI. Up to 0.9 it shipped inside the framework's package;
that history is [`@pinecall/agents`'s CHANGELOG](https://github.com/pinecall/agents/blob/main/CHANGELOG.md).
The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
