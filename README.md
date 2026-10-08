# pinecall

The CLI for [Pinecall](https://pinecall.io) agents: link a project to your org, print the prompt a
state produces, chat with the agent in a terminal, run its goldens, and start the process that
answers its calls — for an agent written in TypeScript
([`@pinecall/agents`](https://github.com/pinecall/agents)) or Ruby
([`pinecall` gem](https://github.com/pinecall/ruby)).

## Install

```bash
npm i @pinecall/agents pinecall   # a TypeScript project: the framework, and this CLI
npm i -g pinecall                 # or once for the machine — a Ruby project needs only this
```

The CLI never loads your class. It starts your project's own serve entry — `@pinecall/agents/serve`
for TypeScript, `Pinecall::Serve` for Ruby — and drives it through the gateway, so the framework
that runs is the version your project pinned.

## Quick start

```bash
pinecall new front-desk          # or --ruby: a project of one agent, ready for every verb below
cd front-desk && npm install     # bundle install for Ruby
pinecall link        # sign in through the browser; writes your key to ./.env
pinecall prompt      # the prompt the model reads, offline; --state <golden> for another state
pinecall chat        # talk to the agent in this terminal
pinecall test        # run the goldens
pinecall start       # run the agent: the process you deploy
pinecall deploy      # or let Pinecall's box run it
```

Every verb acts in the sandbox unless `--prod` is given. The CLI reads `PINECALL_KEY` and
`PINECALL_URL` from the environment or the project's `.env`.

| | |
|---|---|
| [docs/quickstart.md](docs/quickstart.md) | nothing to an agent that answers, in ten minutes |
| [docs/the-cli.md](docs/the-cli.md) | every verb |
| [Deploy to Pinecall](https://docs.pinecall.io/guides/deploy/) | `pinecall deploy`: Pinecall installs and runs your project |
| [ARCHITECTURE.md](ARCHITECTURE.md) | the CLI file by file |

## Development

```bash
pnpm install         # links ../agents, the framework's checkout, when its version fits
pnpm test
pnpm lint
scripts/check        # build, lint, test — what CI runs
```

## License

[Apache-2.0](LICENSE), including its patent grant. No CLA.
