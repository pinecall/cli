# pinecall/cli

The `pinecall` CLI: every verb a tenant types, for an agent written in any language. It never
loads a class — it starts the agent's language's serve entry in a child process and drives it
through the gateway. Reply to the human in Spanish; code, comments, commit messages and this file
in English. What it is: [ARCHITECTURE.md](ARCHITECTURE.md). Every verb: [docs/the-cli.md](docs/the-cli.md).
Procedures with traps in them are skills under `.claude/skills/`.

## Workflow

```bash
pnpm install                     # this repo, and the framework linked from the checkout next door
pnpm test                        # every verb, from the sources
pnpm lint                        # tsc over src and test
scripts/build                    # what is published: dist/ (tsc)
scripts/check                    # build → lint → test — what CI runs
pnpm vitest run test/deploy.test.ts   # one file; `-t "a sentence"` for one test
cd ../agents/examples/clinica-norte && node ../../../cli/bin/pinecall.js prompt --state <golden>
cd ../ruby/examples/clinica_norte && RUBYLIB=../../lib node ../../../cli/bin/pinecall.js prompt --state <golden>
```

The framework is `@pinecall/agents`, by range in `dependencies`; `pnpm-workspace.yaml` links its
checkout beside this one when its version satisfies that range, so nothing is built to test.

## Structure

- `src/` — one module per verb group (`index.ts` dispatches, lazily), and beside them what the
  verbs share: `env.ts` (the door), `language.ts` · `child.ts` · `serving.ts` (the serve entry and
  its process), `companion.ts` + `ui/` (what answers a console), `testing/`, `runs/`
- `test/` mirrors `src/`; `the-tree` and `the-imports` are the tree's rules; `clinic/` and
  `bidfire/` are projects the verbs run against
- `docs/` `quickstart.md` and `the-cli.md` — published on docs.pinecall.io; `deploying.md` points at the site's page

## Docs are part of the change

**A change lands with the page that describes it, in the same commit.**

| you changed | edit |
|---|---|
| a module, the import table, what the child is started with | `ARCHITECTURE.md` |
| a verb, a flag, an exit code, a refusal | `docs/the-cli.md` — and `../docs/pages/guides/deploy-to-pinecall.md` for `deploy` and `secrets` |
| an MCP tool: its schema, its manual, a stage | `scripts/mcp-pages` rewrites `docs/mcp/`; a new tool also needs its call in `docs/mcp/examples.json` and its row in `docs/the-mcp.md` |
| an install step | `README.md` |
| a procedure with a trap in it | the skill under `.claude/skills/` |
| anything a tenant would notice | `CHANGELOG.md`, one line under `Unreleased` |

Before committing a rename: `grep -rn '<the old name>' ARCHITECTURE.md README.md CLAUDE.md docs .claude/skills`.

## Rules the tests enforce

- **Never the framework.** `src/` imports `@pinecall/agents/client` and `@pinecall/agents/wire`,
  never `@pinecall/agents` bare and never `/serve`: a class runs in its serve entry, which is the
  only way a Ruby agent gets served too. `test/the-imports.test.ts`.
- **No port.** Nothing under `src/` calls `createServer` or `.listen(`; `test/verbs.test.ts`.
- No file over 400 lines, every file opens with a line saying what it is, no two names in one
  directory one letter apart. `test/the-tree.test.ts`.

## Traps — each one cost an afternoon

- **The CLI reads `PINECALL_KEY` and `PINECALL_URL`, and nothing else.** From the process's
  environment, else from the nearest `.env` up from the cwd — the project's, which `pinecall link`
  wrote (`src/env.ts`). v1's `PINECALL_API_KEY` is never read, and there are no profiles to switch:
  another org is another folder. `PINECALL_URL` is the one gateway, serving both worlds; `--prod`
  on any verb acts in production for that one command, and without it a verb acts in the sandbox —
  same URL, same key, the `pinecall-env` header saying which.
- **The child gets its door in its environment, never its argv** (`PINECALL_URL`, `PINECALL_KEY`,
  `PINECALL_ENV`): an argv is read by every process on the machine.
- **A TypeScript agent is served by the project's own `@pinecall/agents`**, resolved from the
  project's root, never by a copy this CLI carries: the framework that runs is the one the project
  pinned. A project without it is refused by name.
- **The child is detached, and its stdin ending means drain.** The first SIGINT/SIGTERM is passed on
  once, as SIGTERM; a second, or 40 s, kills it. A process manager's kill timeout is 45 s.
- `pinecall test --voice` is ring 2: the same goldens to `POST /v1/evals/run` with `voice: true`;
  whether a spoken line answers is the gateway's.
- **zsh `noclobber`**: `cat > file` refuses to overwrite. `>|`.

## Commits and releases

A subject line and a body that says why. `pnpm lint` and `pnpm test` exit 0 before a commit. A
release is a `v*` tag, which `release.yml` publishes, after the `@pinecall/agents` it depends on is
on npm. The last number goes up; the CHANGELOG section moves from Unreleased in the same commit.
