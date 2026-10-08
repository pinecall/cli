# Architecture — `pinecall`, the CLI

What this repository is, file by file. The CLI is a client of the gateway's doors and of nothing
else, and it never loads an agent's class: it starts the class's language's serve entry in a child
process and drives it through the gateway. So one CLI serves a TypeScript project and a Ruby one
alike. Every verb, from the user's side, is [docs/the-cli.md](docs/the-cli.md).

---

## 1. Where it sits

| repository | what it owns |
|---|---|
| `pinecall/runtime` | the gateway, its doors, the wire, the real time |
| `pinecall/agents` | `@pinecall/agents`: the TypeScript class, the prompt, and `@pinecall/agents/serve`, the entry this CLI starts |
| `pinecall/ruby` | the same for Ruby: `Pinecall::Serve` |
| **`pinecall/cli`** (this one) | `pinecall`: every verb, the child it starts, the companion socket that answers the console |

It reaches the framework in two ways only, and `test/the-imports.test.ts` holds both:

- it **imports** `@pinecall/agents/client` (the socket, signed requests) and
  `@pinecall/agents/wire` (the runtime's shapes) — never `@pinecall/agents` bare, never `/serve`;
- it **starts** a serve entry: `<verb> --file <agent> --slug <folder> [--console] [--events]`, its
  door in `PINECALL_URL`, `PINECALL_KEY` and `PINECALL_ENV`, its `--events` lines
  `{type, agent, call, data}` on stdout with `agent.registered` first, a drain when its stdin ends.
  A TypeScript agent's entry is the project's own `@pinecall/agents/serve`, so the framework that
  serves it is the version the project pinned; a Ruby agent's is the gem's.

## 2. The tree

| file | what it is |
|---|---|
| `index.ts` | the dispatcher: one lazy import per group, and the whole CLI on one screen |
| `groups.ts` | the `Group` contract, and `PLANNED` — every verb the design declares that this tree has not written |
| `env.ts` · `dotenv.ts` | where the CLI is pointed and what opens the door, for every verb: `PINECALL_KEY` and `PINECALL_URL` (the one gateway, serving both worlds) from the environment, else from the nearest `.env` up from the cwd — read, and written by `link`, as plain dotenv lines — then the door of the world asked: the same URL and key, the world riding the request (`pinecall-env`); a server's token (`pc_live_`/`pc_test_`) has its prefix's world and is refused when `--prod` names the other; the `NO_KEY` refusal |
| `new.ts` | `pinecall new`: a project written from `templates/` — `common/` and the language's tree, `__slug__` in a path and `{{word}}` in a file replaced, `_gitignore` written as `.gitignore` because npm drops a published one. A TypeScript project depends on this CLI's version and the `@pinecall/agents` range it is released with |
| `this-machine.ts` | the machine's name a key is labelled with |
| `linking.ts` · `org-key.ts` · `git.ts` | `pinecall link`: this project's folder tied to one of the person's orgs — signs the machine in if it is not, picks the org, and warns while git would commit `.env`. `org-key.ts` is the same as data, for any front: the person's orgs (`GET /v1/login/orgs`), the key minted in the one chosen (`POST /v1/login/org`) and written into `./.env`; `git.ts` is the one place git is asked anything |
| `signed-in.ts` | `~/.pinecall/session.json` (0600, `PINECALL_HOME` moves it): the machine's sign-in per gateway, which only `link` mints from, and the phone `pinecall line from` kept |
| `world.ts` | which of the two worlds a verb works in: `--prod`, taken out of argv before any group sees it, names production for that one command; nothing named is the sandbox |
| `client-for.ts` | the SDK client a verb holds: the door's gateway, its key, and the world that gateway is — the one client every verb that opens a socket builds |
| `connected.ts` | the one line `start` prints when the socket is up: who registered, whose org took it, which world, and where the key came from |
| `language.ts` | an agent's language by its file (`agent.tsx`/`.ts`, `.rb`, `.py`), and what its serve entry is started with (`startedWith`): Node on the **project's own** `@pinecall/agents/serve`, found in the `node_modules` of the project's root or a folder above it and nowhere else — never `NODE_PATH`, which pnpm points at its store (`serveEntryOf`; a project that does not install it is refused by name), with this CLI's tsx when that entry is a checkout's `.ts` and `--inspect…` passed on; `ruby -r pinecall -e 'exit Pinecall::Serve.main(ARGV)'` through bundler when there is a `Gemfile`; Python refused. The door in the environment, never in the argv |
| `serving.ts` · `child.ts` | what a serve entry's `--events` stdout says, read off any stream: the app each agent registered as (a later registration replaces it), every entry after, a line that is no entry passed to stderr. `child.ts` is the process: spawned detached with its stdin a pipe, the first SIGINT or SIGTERM passed on as one SIGTERM, killed after a 40 s grace or on a second signal; `runOnce` for `prompt` |
| `home.ts` | **the one layout**, and an agent's *home* in it: `agents/<name>/agent.ts` (with whatever only that class uses beside it), `lib/` for what agents share, `docs/<name>/` for the local folder `docs push` sends by default (never tracked: the base is on the gateway), `test/<name>/agent.test.ts`, `test/<name>/goldens/` (the conversations, and beside them `docs.json` and `memory.json`, the retrieval and recall goldens), `test/<name>/memory/`. No verb computes a path of its own; `--agent` resolves here. What the agent knows by heart is in no folder: it is a setting |
| `console.ts` | `pinecall console`, the console of the world in a browser: a one-use code the gateway minted in that world for this terminal's key, and the page opened at the gateway's root for production or under `/sandbox` for the sandbox. It binds nothing — **no code under `src/` opens a port**, and `test/verbs.test.ts` pins that |
| `start.ts` · `companion.ts` | `pinecall start`: the agents' serve entry started and watched (signals passed on once, its lines printed), and beside it the companion socket — `answersDev`, `takesUnclaimed: false`, no declaration, `sdk` `pinecall-cli/<version>` — that answers the console's verbs for every agent, reaching the agent's process by its app id |
| `start-console.ts` · `start-screens.ts` | the `console` line `start` prints — the console of the world it registered in, with a one-use code minted there (`aLoginCode`, the one mint of a login code) — and the two screens over the agent's process: the plain log and `--ui`, both ending when it does |
| `start.ts` · `chat.ts` · `chat-url.ts` · `answered.ts` · `prompt.ts` | the app, the app in this terminal — or a written call at an agent somebody else is holding, named by slug — and the prompt offline; `answered.ts` is the one rule of when a written caller is owed nothing more (every line heard as a turn, the agent listening again), for any front that chats; `chat-url.ts` is where a written call is dialled and how long a dropped one is redialled |
| `test.ts` · `simulate.ts` · `simulation.ts` · `eval.ts` · `runs/` | the goldens, a live persona, one call replayed, and what the gateway has run; `simulation.ts` is one simulated call as a core any front runs — written or spoken, judged — and `simulate.ts` the terminal's front that serves the agent and, with `--listen`, hands it the ear |
| `agent.ts` · `agent-setting.ts` · `agent-lines.ts` · `agent-versions.ts` · `agent-files.ts` · `agent-knowledge.ts` · `agent-processes.ts` | **the settings**: what the org set over the class — yours, the team's, production's — on one page (`agent-lines.ts`, a row per field, `knowledge` as a count of characters and `bases` by name); the whole set written with the version it was read at, or fields cleared; the versions — history, diff, rollback — and a corner as a file for CI; `agent knowledge` prints what the agent knows by heart and `agent knowledge edit` opens it in `$EDITOR` (`editor.ts`, the one place the editor is started) and keeps what was written as the next version (`knowledgeWritten`, which takes the text from any front); `agent list` and `agent stop` are the processes holding the org's agents. `--prod` writes production's corner directly, while the person's org lets them act there: history and rollback are the safety, and the goldens run in CI before a deploy. `pipeline.ts` only reads now |
| `lexicon.ts` · `memory-policy.ts` | an agent's words, whole and versioned per corner — production's with `--prod` · the memory field of the settings on its own |
| `docs.ts` · `docs-attach.ts` · `memory.ts` · `remember.ts` | **the documents the agent searches** — `docs/<name>/` pushed whole under a name, listed, dropped — and `attach`/`detach`/`attached`: which bases an agent reads, which is one field of its settings (`bases`) written as the next version · one contact's facts, the right to be forgotten, and `memory policy` · the extraction goldens. `docs eval` and `memory eval` each hold a golden: `recall@k` and `nDCG@10`, computed in the gateway by code with no model, exit 1 on a miss |
| `numbers.ts` | which number reaches which agent: the org's doors at this instance listed, one imported off its carrier, one let go — a number is one instance's, and nothing moves it |
| `providers.ts` | the provider keys this org brought of its own: one added from stdin, one taken back, the vendors read by name — never a value |
| `voices.ts` · `voice-sample.ts` | a vendor's voices in a language, the id first (`voice-sample.ts` is it as data, for any front: the catalogue, the voices, a sample and its timings); and one said by the gateway — the wire's `VoiceSample`, no words means the gateway's own line — played on this machine from a file, kept where `--save` says, with its first-audio time when the gateway timed it |
| `players.ts` | the audio players a machine might have, once: how each takes raw samples (`--listen`) and how it takes a file (`voices play`), the first one on the PATH, and a file played on it — the one place a sample is played |
| `personas.ts` · `view.ts` | the ORG's synthetic callers — listed, written, renamed, dropped and tried against the class here, all of them kept by the gateway, one list whichever agent answers them (`--agent` is only `try` and `push`, the two that need the class; `push` is the one-time migration for a project that still has the files) — the terminal view as a pure function |
| `deploy.ts` · `deploy-logs.ts` · `packed.ts` · `org-secrets.ts` | `pinecall deploy`: refused for a project with an agent in another language than TypeScript (the box runs Node), and when the project's `package.json` lists `pinecall` or `@pinecall/agents` nowhere in `dependencies` (the box starts its own `pinecall start`), else the project packed as a release — every file its `.gitignore` files leave in, each read where it sits and no git asked (the `ignore` package), never `node_modules`, `.git`, `dist` or a `.env`, written as gzipped ustar by hand (`packed.ts`) — uploaded to `POST /v1/hosted/{name}/releases`, and followed on `GET /v1/hosted` until it is live, failed or replaced; `list`, `releases`, `rollback` (the gateway keeps an old release's sources as the next), `stop`, `start`, `rm`, and `logs` (`deploy-logs.ts`: asked, waited for until the box sends lines read after the ask, and followed by printing what a newer read adds). `pinecall secrets`: the org's secrets per world, set from a silent prompt or stdin, never read back |
| `judges.ts` | the agent's own judges — a question about its job, asked of its calls at hang-up beside the runtime's panel — listed, written and dropped at the agent's door; the agent is the project's one, or `--agent` |
| `login.ts` · `pairing.ts` · `browser.ts` · `whoami.ts` · `secret.ts` | the browser dance that signs this machine in — `pairing.ts` is it as data (a one-use word asked for, its link, the key collected once, verified and kept for `link` to mint from, never run on) and `login.ts` the terminal's front that prints the link and opens it — how a URL is put in front of a person, which key a verb would use and whether it acts in production, and the one place a terminal is read |
| `testing/` | what those verbs need: the gateway's eval doors, goldens off disk, latency, the matrix, the model a short name means, for `test --model` and for `agent set --llm` alike (`models.ts`), the progress screen, the score, the voice door, the callers as the gateway keeps them (`personas.ts`) and the files a project pushed them from, read once (`caller.ts`) |
| `scripts/mcp-pages.ts` | the MCP's tool pages under `docs/mcp/`, one per stage of `tools/all.ts`: each tool's sentence and manual, its parameters from its zod schema, and its call in `docs/mcp/examples.json` (recorded against Pinecall Cloud, anonymized); `test/the-mcp-pages.test.ts` fails a page that is not what it writes, an example its tool would refuse, and a parameter with no description |
| `generate.ts` | `pinecall generate` (`g`): a second agent from `new.ts`'s templates (`anAgentWritten`), and a golden from the caller's lines; the `project` tool's `generate` calls the same two functions |
| `mcp/` | `pinecall mcp`, the same CLI as an MCP server (`docs/the-mcp.md`): `server.ts` registers every tool of `tools/` on one stdio connection, each described by its sentence and its manual, turns each answer and refusal into scrubbed text (`scrubbed.ts`), and traces each call to stderr (the tool, the time, ok or refused — never its arguments); `tool.ts` is a tool (name, sentence, zod schema, manual, a handler over a core of `src/`), `tools/all.ts` the tools by stage, which `instructions.ts` names after the journey, `tools/fields.ts` the fields many take (`agent`, `prod`, `wait_s`); `session.ts` is one server's state — the project folder (the server's cwd moves there, with nothing held), its door (production only when the server was started with `--prod` and the tool says `prod`), the agents held, the calls open, a golden run and a simulation in flight, the docs read; `holding/` holds the agent: `thread.ts` runs the project's own serve entry's `main` in a worker thread (no process; its stdin's end drains it, as the CLI's child), `framework.ts` lends a TypeScript project with nothing installed the server's own `@pinecall/agents` — to the thread alone: a resolver hook answers `@pinecall/agents` from the server's copy, and a tsconfig in the server's temp folder gives the project's files the framework's flags — so `start` and `prompt` run on a fresh project and nothing is written into it; `held.ts` attaches to the agent's own process already holding the slug (never a companion: `companion.ts` names both of them, `pinecall-cli/` and `pinecall-mcp/`) or starts the thread — with the companion beside it, so the console reaches it — and reloads it on a save — the new version registers before the old drains, a save that does not load keeps the old answering — and `talking.ts` is a written call over `/v1/chat`, each line answered whole by `answered.ts`'s rule; `site.ts` is docs.pinecall.io's `llms-full.txt` cut into pages and searched; `collected.ts` keeps what a CLI core writes as a tool's lines; `install/` writes the server into every assistant's config, one entry and nothing else. **Nothing it reaches starts a process**: `test/the-mcp-starts-nothing.test.ts` walks its imports, static and dynamic, and the MCP SDK and zod are imported under `mcp/` alone |
| `version.ts` | the CLI's version, from its own `package.json`: `pinecall --version` and the MCP server's handshake |
| `ui/` | what `pinecall start`'s companion answers a console with, by the wire's verb (`doors.ts`, one module per verb family: a chat, a simulation, a suite, the docs and memory goldens, a promotion, drift, a reproduction). Node modules: the page is `../console`, and it never imports them — it asks the gateway, and the gateway asks this process |

Beside `src/`:

| | |
|---|---|
| `test/` | mirrors `src/`, plus the rules: `the-tree` (400 lines, a first line, no near-twin names), `the-imports` and `the-mcp-starts-nothing`; `test/clinic` and `test/bidfire` are projects the verbs run against |
| `bin/pinecall.js` | the bin of a checkout: the CLI from source through tsx. npm installs `dist/index.js` instead |
| `scripts/build`, `scripts/check`, `scripts/the-version` | what is published, what CI runs, and the version a tag must equal |
| `docs/` | `the-cli.md`, every verb; `the-mcp.md`, the MCP server; `quickstart.md`; `deploying.md` points at the site |

## 3. The verbs

`pinecall <group> [args]`. One module per group, imported only when it is asked for — `pinecall
prompt` must not pay for a websocket client.

| verb | what it is | needs a gateway |
|---|---|---|
| `link` | this project's folder tied to one of the person's orgs: their key for it, written to `./.env` | yes |
| `start` | the agent's serve entry started and watched, and a companion socket that answers the console: **the process you deploy**. Binds no port, serves no page. `--prod` for production | yes |
| `console` | the box's console in a browser, signed in as this project's key through a one-use code: the sandbox's, or production's with `--prod`. It serves nothing itself | yes |
| `line` | which phone is yours — it reaches your sandbox copy on the production number too — and whose terminal anybody else's call rings in; `claim` takes it | yes |
| `chat` | the agent served by a process this terminal starts (`serve start --console --events`), and a written caller against it | yes |
| `prompt` | the exact prompt a state would produce, printed by the agent's serve entry | **no** |
| `test` | ring 1: the goldens, through the agent a serve entry this verb starts holds, scored by the runtime | yes |
| `simulate` | a model plays one persona, live; `--judge` prints the `call.score` | yes |
| `eval` | ring 3: one real call re-evaluated by the runtime's code checks | yes |
| `runs` | `list · show · diff · promote · drift` — what this gateway ran, and what moved | yes |
| `personas` | `list · show · add · edit · rm · try · push` the org's synthetic callers, kept by the gateway | yes |
| `judges` | `list · add · rm` the agent's own judges: a question asked of its calls at hang-up, kept by the gateway | yes |
| `agent` | the settings, three corners side by side · `set` · `clear` · `knowledge [edit]` — what the agent knows by heart, printed or opened in `$EDITOR` · `history` · `diff` · `rollback` · `pull` · `push` · `list` · `stop` | yes |
| `lexicon` | an agent's words — said and heard — versioned per corner | yes |
| `docs` | `push [dir] [--base <name>]` · `list` · `drop <base>`: the folder of `*.md` under `docs/<name>/` sent whole to `PUT /v1/knowledge/{base}` · `eval`: `test/<name>/goldens/docs.json` asked of the base · `attach <base> [--k n] [--mode …] [--min-score x]` · `detach` · `attached`: which bases the agent reads, one field of its settings | yes |
| `memory` | `<contact>` · `forget <contact>`: one contact's facts, current first, and the right to be forgotten · `policy`: what is remembered and what never is · `eval [--k n]`: every question of `test/<name>/goldens/memory.json` asked of `recall`, each bringing its own facts, and the two figures a golden answers | yes |
| `remember` | the extraction goldens in `test/<name>/memory/`: one written call each, one model call each, judged by code | yes |
| `login` | a link printed and opened; the page signs this machine in and mints it a key of its own, proved at the gateway and kept in `~/.pinecall/session.json` (0600) for `link` to mint from — no verb runs on it | yes |
| `sessions` | `list` and `show <call>`: the calls this org has taken, and one read whole off its log | yes |
| `pipeline` | the three legs as the NEXT call would be built, read back. The six knobs are `agent set`'s | yes |
| `numbers` | which number reaches which agent: listed, one imported off the carrier, one let go | yes |
| `supervise` | the six verbs at a live call from a terminal: whisper, say, takeover, release, transfer, end | yes |
| `providers` | the vendor keys this org brought, added from stdin and taken back; the vendors read by name | yes |
| `voices` | a vendor's voices by language and country, and one played here with its first-audio time | yes |
| `callbacks` | what an agent's tool asked a human to call back about, newest first | yes |
| `data` | the org's data: a call or a contact erased, the erasure trail, who read its calls, its policy (retention, calling hours, calls a day per number, consent everywhere, the disclosure and the recording notice), a number's consent, the do-not-call list (`data-lists.ts`), the world exported as JSON Lines | yes |
| `deploy` · `secrets` | the project uploaded as a release the box installs and runs, and the org's secrets it is started with ([docs/deploying.md](docs/deploying.md)) | yes |
| `whoami` | both doors — production's and the sandbox's — which org each key is, whether it acts in production, and **where it came from** | yes |

`groups.ts` also declares every verb the design names and this tree has not written — `new`, `g`,
`observe`, `costs`, `call`, `tokens`. Typing one prints what it *will* be and exits 0. A verb leaves that table in the commit
that writes it.

**Where the key comes from** (`src/env.ts`, the one place that decides it, for every verb):
`PINECALL_KEY` and `PINECALL_URL` from the process's environment — a server's secrets, a CI job's —
else from the nearest `.env` walking up from the cwd (`src/dotenv.ts`), which `pinecall link`
wrote. `PINECALL_URL` is `https://cloud.pinecall.io` unless one of the two names another, and it is
**the one gateway, for both worlds**: where a person signs in, and where every verb knocks. A
project folder is the org it was linked to; a second org is a second folder, and nothing is
switched. With no key the verb stops on `NO_KEY`, naming `pinecall link`. Every verb that connects
opens with `doorLine`: `gateway <url> · key from <the environment | the .env's path> · <world>`.

**Which world** is the command's, and the gateway decides it from the key and the header, never
from the name: `--prod` anywhere on the line (`src/world.ts`, taken out of argv before the group
parses it) names production for that one command; nothing named is the sandbox. Every request and
socket says the door's world in `pinecall-env` (`signed` from `@pinecall/agents/client`): a person's key opens both
worlds and the header picks one (absent, the sandbox); production lets a person through only while
their `production` switch is on — an admin's always is. A server's token has the world its prefix
names, nothing is derived, and `--prod` must agree (`src/env.ts:doorIn`).

It was four files, three variables and then a file of profiles, and each time the one that won was
the one you had not chosen: v1's `PINECALL_API_KEY` beat what `pinecall login` had just kept, and a
profile switched in one terminal moved every other. `PINECALL_API_KEY` is never read. The only
file under `~/.pinecall/` is `session.json` (0700 directory, 0600 file): the machine's sign-in,
which `link` mints from and no verb runs on, and the sandbox's door — derived from a project's key,
so it is never written into the project.

## 4. The console's verbs

A console asks the gateway, and the gateway relays a dev verb to the process registered with
`answers_dev` for that agent in that person's corner: `pinecall start`'s companion socket
(`companion.ts`), which takes no call, sends no declaration and names itself
`pinecall-cli/<version>`. It answers from `src/ui/` and reaches the agent's own process by the app
id the child registered as. `view.render` alone is the child's: the class draws its own panel.

## 5. LiveKit

`@livekit/rtc-node` is an optional dependency, imported lazily in two files, `src/ear.ts` and
`src/listening.ts`, which put `simulate --listen` on this machine's speakers. Nothing else here
knows LiveKit: a seat is minted through a door, and the room is the gateway's.

## 6. Packaging

- `package.json`'s `bin` is `bin/pinecall.js`; `publishConfig` swaps in `dist/index.js`, built by
  `scripts/build` (`tsc`, `src` → `dist`). `pnpm pack` applies `publishConfig`; `npm pack` does not.
- `@pinecall/agents` is a real range in `dependencies`, and `pnpm-workspace.yaml` links the
  framework's checkout beside this one whenever its version satisfies it
  (`linkWorkspacePackages`): the CLI is tested against the framework of the same checkout and
  published depending on a version npm has. A release of the framework goes out first.
- `scripts/check` is build → lint → test; CI runs exactly that.
