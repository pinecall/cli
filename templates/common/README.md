# {{Title}}

A Pinecall agent in {{Language}}: it answers from your documents, takes a message, and hangs up.

```
agents/{{slug}}/              the class: its state, its tools, its prompt
test/{{slug}}/                ring 0, the class as software ({{ring0}})
test/{{slug}}/goldens/        ring 1, conversations the model must hold (pinecall test)
```

```bash
{{install}}
pinecall link        # signs this machine in and writes this folder's key to .env
pinecall prompt      # the exact prompt the model reads, offline
pinecall chat        # talk to it in this terminal
pinecall test        # the goldens, against a real model
pinecall start       # answer calls; `pinecall console` opens the console beside it
```

The voice, the model, the greeting and what it knows by heart are its settings, not its code:
`pinecall agent set --help`, or Settings in the console. Every verb: https://docs.pinecall.io/cli/overview.
