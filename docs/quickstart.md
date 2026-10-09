# Quickstart

From nothing to an agent that answers, in ten minutes.

You need Node 24 and a Pinecall account.

## 1. The CLI

```bash
npm i -g pinecall
```

## 2. A project

```bash
pinecall new front-desk
cd front-desk
npm install
```

`front-desk` is the agent's name on Pinecall, and the folder's. Inside:

```
agents/front-desk/agent.tsx       the class: its state, its one tool, its prompt
test/front-desk/                  unit tests: the class as software, no network (npm test)
test/front-desk/goldens/          goldens: a conversation the model must hold (pinecall test)
```

The agent answers from the documents it is given and, for anything else, takes a message: the
caller's name and what the call is about, written down by its `takeMessage` tool.

In Ruby or Python, only this step changes; every verb below is the same:

```bash
pinecall new front-desk --ruby      # agents/front-desk/agent.rb, then: bundle install
pinecall new front-desk --python    # agents/front-desk/agent.py, then: uv sync
```

The tool is `take_message` there, and the unit tests run with `bundle exec rake` or `uv run pytest`.

## 3. Your org

```bash
pinecall link
```

It signs this machine in through the browser, asks which of your orgs the project is, and writes
your key to `./.env`, which the project's `.gitignore` already keeps out. Every verb reads it
from there. `pinecall whoami` says which org and gateway a verb would use.

## 4. The prompt

```bash
pinecall prompt
```

The exact prompt the model reads when a call opens, offline: the class's docstring, the rules,
the tools, and the view. Change the class and run it again.

## 5. Talk to it

```bash
pinecall chat
```

```console
‹ Hi, I'm Ana Lopez. Please tell the manager my last order arrived broken.
→ takeMessage({"name":"***","about":"last order arrived broken"})
› Got it, Ana. Your message has reached the team. Goodbye!
```

`→` is the tool the model called, with what the class declared private masked; `›` is the agent.
Ctrl-D hangs up.

## 6. Hold it to a golden

```bash
pinecall test
```

```console
front-desk · 1 golden · the app's own model
  ✓ takes-the-message  llm_node_ttft 380ms
  1/1 · 0 judge calls · $0.0027 · 2s
```

A golden is a conversation and what must come of it: here, that the message is taken. Add one
per behaviour you care about in `test/front-desk/goldens/`.

## 7. Give it documents

```bash
mkdir -p docs/front-desk
printf '# Refunds\n\nA refund reaches the card it was paid with within ten working days.\n' > docs/front-desk/refunds.md
pinecall docs push                 # the folder, as a base named front-desk
pinecall docs attach front-desk    # the agent searches it on every turn
pinecall chat                      # ask it how long a refund takes
```

## 8. Its voice, and the rest of its settings

```bash
pinecall voices --language en      # the voices, with their ids
pinecall agent set --voice <id>
pinecall agent                     # every setting: voice, models, language, greeting…
```

The voice, the models, the language and what it knows by heart are settings of the agent, not
code: changing one needs no deploy. `pinecall console` opens the same settings in the browser,
with every call the agent has had.

## 9. Answer calls

```bash
pinecall start
```

This is the process that answers: on your laptop now, on your server later. It holds the agent
until Ctrl-C, prints every call as it happens, and a link to the console.

To ship it, `pinecall deploy` uploads the project and Pinecall runs it for you
([deploying.md](deploying.md)).

Everything above ran in your org's **sandbox**. `--prod` on any verb acts in production instead.
Every verb and flag: [the-cli.md](the-cli.md).
