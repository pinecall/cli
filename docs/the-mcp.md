# The MCP server

`pinecall mcp` is the same CLI as an [MCP](https://modelcontextprotocol.io) server: an assistant —
Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Antigravity, Gemini CLI — launches it, and its
tools take a person from an empty folder to an agent on Pinecall without a terminal.

The server starts no process of its own: what needs a browser, an editor or a speaker hands the
link, the text or the file back instead. Every tool acts in the **sandbox**. No tool takes a vendor
key, a carrier secret or an app's secret, and no answer carries a Pinecall key: every answer and
every refusal is scrubbed before it reaches the model.

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
| `--prod` | writes `--prod` into each entry, so a tool may act in production; your org's switch still decides |

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

| tool | actions | what it does |
|---|---|---|
| `whoami` | — | which org, gateway and environment the project's key acts in, and whether production is allowed for the key and for this server |
| `login` | `start` · `status` | signs this machine in: `start` answers a link the person opens in a browser; `status` waits (`wait_s`, at most 50) until they approved it. The key is kept in `~/.pinecall/session.json` and never answered |
| `link` | `orgs` · `write` | the person's orgs, and the key of one written into the project's `.env` (`PINECALL_KEY`, and `PINECALL_URL` when the gateway is not Pinecall Cloud); it warns when `.gitignore` does not name `.env` |
| `project` | `show` · `open` · `new` | the folder the tools act on, its agents and their language, whether it has a key; another folder opened; a new project of one agent written from `pinecall new`'s templates, in TypeScript or Ruby, and opened |

A refusal is one sentence that names what to do next: no project names `project`, no key names
`link`, no sign-in names `login`.

## Not in the MCP

What cannot be undone is never a tool: erasing data, forgetting a contact, dropping a base, a number
or a carrier, removing a deployed app. Neither is anything that takes a secret. Those stay
`pinecall` verbs a person types.
