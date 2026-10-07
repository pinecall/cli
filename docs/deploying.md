# Deploy to Pinecall

`pinecall deploy` runs your project on Pinecall's machines: you upload the folder, the box installs
it and keeps `pinecall start` running for you, in a container of its own. There is no server to
rent, no process manager to configure and no token to paste. If you would rather run the process
yourself, [production.md](https://github.com/pinecall/agents/blob/main/docs/production.md) covers your own server; this page is the third way.

```console
~/acme-support $ pinecall deploy --prod
acme-support: release 1 sent · 38 KB · 3b507661b052
acme-support: the box installs and starts it; the release before keeps answering meanwhile
acme-support: release 1 is live
```

## Before the first deploy

**The project.** The layout [writing-an-agent.md](https://github.com/pinecall/agents/blob/main/docs/writing-an-agent.md) describes — `agents/<name>/`
at the root, a `package.json` and a `tsconfig.json` — with three things the box relies on:

- **`pinecall` and `@pinecall/agents` under `dependencies`**, not `devDependencies`: the box
  installs production dependencies only, starts the project's own `pinecall start`, which serves
  through the project's own framework, and the versions your lockfile pins are the ones that run.
  `pinecall deploy` refuses a project that lists either one nowhere in `dependencies`, before it
  sends anything.
- **A lockfile, committed**: `pnpm-lock.yaml` (installed with `pnpm install --frozen-lockfile
  --prod`, the pnpm version your `packageManager` field names) or `package-lock.json` (`npm ci
  --omit=dev`). With neither, `npm install --omit=dev` resolves `package.json` afresh on every
  release, so two releases of the same sources can install different versions.
- **Every package your code imports under `dependencies`.** Anything only under `devDependencies`
  — a test runner, a type package — is not installed, which is what you want; a library your
  agent's tools call must be a real dependency.

There is **no build step**. `pinecall start` reads your `agent.tsx` directly (it needs the class's
docstrings and parameter types, which a compiler throws away), so the sources are what runs.

**Node 24.** The box runs every app on the official `node:24-slim` image. A dependency that
compiles native code at install time finds no compiler there: use packages that ship prebuilt
binaries for linux-x64, which most do.

**A key that may deploy.** `pinecall deploy` knocks with the same key as every other verb — your
own after `pinecall link`, or a server's token in CI ([below](#from-ci)). It needs the `app` scope
(the developer and admin roles have it), and `--prod` needs your production switch on.

**The app's name.** Lower-case words and dashes, 40 characters at most: `support-line`. It is the folder's name unless you
pass `--name`, and it is the org's: two folders deploying under one name are two releases of one
app. The first upload makes the app, within your plan's number of hosted apps.

## What travels

The folder is packed the way git would commit it — tracked files and untracked ones `.gitignore`
does not exclude — or every file when the folder is not a git checkout. Whatever it is, these never
leave your machine:

| left out | why |
|---|---|
| `node_modules/` | the box installs from your lockfile |
| `.git/`, `dist/`, `.pinecall/`, `.DS_Store` | history, build output and local state are not the app |
| `.env`, `.env.*` | your key and your secrets: the app gets a token of its own, and its secrets are set apart |

A release is at most **10 MB packed, 100 MB unpacked and 5 000 files**; a symbolic link, a device
or a path that leaves the folder is refused before anything is kept. Every release stays on the
gateway, listed by `pinecall deploy releases`, so a rollback never needs your machine.

## What happens after you press enter

1. **Kept.** The gateway checks the tarball and keeps it as the app's next release: numbered from
   1, never edited. The first release makes the app and mints a server's token for it — it appears
   in the console's Tokens as `hosted app <name>`, and nobody ever sees its value.
2. **Installed.** Within five seconds the box's runner for that world picks it up and installs the
   dependencies inside the same sandbox the app will run in: five minutes and 1 GB at most.
3. **Started.** `pinecall start` (`--prod` in production) starts in a container of its own, with
   the org's secrets, the app's token and the gateway's address in its environment. Every agent
   under `agents/` runs in that one process.
4. **Live.** Once the new process's agents have registered with the gateway, the release is live,
   and only then is the release before it told to stop: it drains — its calls move to the new
   process, its running tools finish, 45 seconds at most — so **a deploy cuts no call**.

The verb follows all of it, printing `release N is live` (exit 0), or why it failed (exit 1), for
up to eight minutes. `--no-follow` returns as soon as the release is kept; `pinecall deploy list`
says where it is later.

**When a release fails, the one before keeps answering.** A release fails when its install fails,
when its process exits before its agents register, or when two minutes pass without a register.
The verb prints the reason and the process's last lines, and `deploy list` keeps saying it:

```console
$ pinecall deploy --prod
support-line: release 7 sent · 38 KB · 9f0c2d4e1a77
support-line: release 7 failed — release 6 keeps serving
the process exited before its agents registered:
pinecall: `voice` is the world's now, not the class's: pinecall agent set --voice <name> — remove it from the class
```

A failed release is not tried again: fix it and deploy again, which makes the next release.

## Secrets: what your code reads

`.env` never travels, so whatever your tools read from the environment — a CRM's address, its key —
is set as the org's **secrets**:

```console
$ printf %s "$CRM_TOKEN" | pinecall secrets set CRM_TOKEN --prod
CRM_TOKEN kept · the org's hosted apps here start again with it
```

Your code reads them as it always did: `process.env.CRM_TOKEN`. What an app is started with is:

| variable | set by |
|---|---|
| every secret of the org in that world | `pinecall secrets set`, or the console's Settings ▸ Secrets |
| `PINECALL_KEY` | the box: the app's own server token, for this world |
| `PINECALL_URL` | the box: the gateway of this world (`https://cloud.pinecall.io`, or the sandbox's) |
| `HOME=/tmp`, `NO_COLOR=1` | the box |

A secret is the **org's, per world**: every hosted app of the org in that world starts with all of
them, so name them for what they are (`CRM_TOKEN`, `BOOKING_API_URL`). A name is capitals, digits
and underscores, never starting with `PINECALL_`; a value is 16 KB at most. A value is typed
without echo or piped, never written on the command line where the shell keeps it, and nothing
ever reads it back — `pinecall secrets` lists names, who set each and when. Setting or dropping one
starts every app of the org in that world again, each new process answering before the old one
drains.

## What an app may do

The app is your own code, run for you, so it runs in isolation:

| | |
|---|---|
| **memory** | 256 MB for the whole process, including what it writes to `/tmp`. An idle agent takes about 75 MB |
| **CPU** | half a core. A tool waiting on your API costs none of it |
| **processes** | 256 |
| **disk** | none that lasts: the project's folder is read-only, and `/tmp` is 64 MB of memory, emptied at every release and restart. Keep state in your own systems, or in what the agent remembers |
| **network out** | the internet, over the public resolvers (1.1.1.1, 8.8.8.8). Never private addresses (10/8, 172.16/12, 192.168/16, 100.64/10), the cloud's metadata address, port 25, nor IPv6 — so a database only reachable inside your own network is out of reach; give it a public address with TLS, or expose an API for the agent |
| **network in** | none: nothing listens, which an agent never needs. Its calls reach it over the socket it opens to the gateway |

Every app runs under gVisor, a kernel of its own between your code and the machine, on its own
network, so an app never sees another's.

## Every day

| | |
|---|---|
| `pinecall deploy list --prod` | every app of the org: `live: release 4`, a release on its way, one that failed and why, or `stopped` |
| `pinecall deploy releases --prod` | one app's releases, newest first: when, size, who, the note |
| `pinecall deploy logs --prod [--follow]` | the last 300 lines the process printed, stdout and stderr, fresh: asking is what makes the box send them, a beat later, so the verb waits up to fifteen seconds for lines read after it asked. `--follow` keeps printing what comes, until Ctrl-C |
| `pinecall deploy rollback 3 --prod` | release 3's sources kept again as the next release and started like any: nothing is deleted, and the history says `rollback to release 3` |
| `pinecall deploy stop --prod` · `start` | stopped, the process drains and nothing runs — releases and token kept, no time counted; started, the newest release runs again |
| `pinecall deploy rm --prod` | the app gone: its releases deleted, its token revoked |

Each takes `--name <app>` when you are not in the app's folder. The console shows the same under
**Settings ▸ Apps** — the state, the logs, the releases with Roll back, Stop and Start — and the
secrets under **Settings ▸ Secrets**.

**Logs are the org's to read**: anybody in the org with the `app` scope can read an app's last
lines, in the console or from a terminal. Never print a secret; `pinecall start` itself prints no
console link when its output is not a terminal, for this reason.

**If the process exits after going live** — out of memory, an uncaught exception — the box starts
it again at once, and its last lines become the app's logs, so `pinecall deploy logs` says why it
exited. After **five exits in ten minutes** it gives up: the release is reported failed with its
last lines, and the app answers nothing until the next release, a changed secret or a
`pinecall deploy rollback`. Watch `deploy list`, or the console's Apps, after a deploy.

## The sandbox and production

Without `--prod`, every verb acts on the sandbox's box; with it, on production's. They are two
separate sets of apps, releases and secrets, as they are two sets of everything else
([worlds-and-teams.md](https://github.com/pinecall/agents/blob/main/docs/worlds-and-teams.md)): deploy to the sandbox, talk to it with `pinecall chat`
or the console, then deploy the same folder with `--prod`. A new org's trial hosts one app, in the
sandbox.

## From CI

A pipeline deploys with a **server's token** of the org (the console's **Tokens ▸ New server
token**, production's made by somebody with production access), after the goldens:

```yaml
# .github/workflows/deploy.yml
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx pinecall test                       # the goldens, on a sandbox token
        env: { PINECALL_KEY: "${{ secrets.PINECALL_SANDBOX_TOKEN }}" }
      - run: npx pinecall deploy --prod --name support-line --note "${{ github.sha }}"
        env: { PINECALL_KEY: "${{ secrets.PINECALL_TOKEN }}" }
```

`pinecall deploy` exits 1 when the release fails, so the job fails with the reason in its log, and
the release before keeps answering.

## When something is refused

| you read | what it means |
|---|---|
| `… does not list @pinecall/agents in dependencies` | the project would not start on the box: both `pinecall` and `@pinecall/agents` belong under `dependencies`; nothing was sent |
| `a release's sources are 10 MB at most packed` · `unpacks to 100 MB at most` · `holds 5000 files at most` | something large is being packed: build output or data that `.gitignore` does not exclude |
| `… is a link or a device` · `… leaves the project's folder` | a symbolic link, or a path outside the folder: a release holds files and folders only |
| `the org has used 1 of its 1 hosted apps in the production` | the plan's number of hosted apps is reached: a new name is refused, a new release of an app you have is not |
| `… is no name for an app` · `an app's name is 40 characters at most` | the name is not lower-case words and dashes, or too long: pass `--name` |
| `installing the dependencies failed:` | the install's last lines follow: a lockfile out of step with `package.json`, a package with no prebuilt binary, a registry that asked for credentials |
| `the process exited before its agents registered:` | `pinecall start` refused the project, and its last lines say why — a class field that is the world's now, a tool with no docstring, a syntax error |
| `agent <slug> belongs to another org: a slug is one org's` | an agent's slug is taken by another org: an agent's slug is its folder's name: rename `agents/<slug>/` |
| `no agent registered from this release within 120s` | the process started and never connected: its last lines follow |
| `the process exited 5 times in 10 minutes and is not run again` | a release that went live keeps crashing: its last lines follow, and `deploy logs` has more |
| `release N was replaced by release M before it went live` | somebody deployed again meanwhile: the newest release is the one the box runs |

## What it costs

On Pinecall's cloud an app costs **$5 a month, prorated by the hours it runs**: the box counts the
time each app serves, day by day, and a stopped app counts nothing. The sandbox hosts one app free.
Its calls are billed as any call is ([pinecall.io/pricing](https://pinecall.io/pricing)). On a
runtime you run yourself, the operator runs the runner (`pinecall-runtime runner start`, on a
machine of its own) and decides its own prices.
