# session-relay

Pick up where your last AI coding session left off, without writing a handoff note.

When you start a new session and say "continue from where we left off", this plugin finds the conversation you were just having — in Claude Code or in Codex — and reads what you actually typed, word for word, instead of a summary. A summary keeps the facts but drops what you were annoyed by and what you cared about; the original words keep both.

[日本語の説明はリポジトリのREADMEへ](https://github.com/shoujiki-panman/session-relay#readme)

## What it adds

- **A skill, `relay`.** Used when you say things like "continue", "pick up the previous conversation" or "前の会話の続きから". It lists the candidate conversations and asks you to choose when there is more than one, rather than guessing.
- **An MCP server, `relay`,** with five tools that read your conversations: `list_projects`, `list_conversations`, `get_context`, `list_deposits` and `get_deposit`.

## What it runs, reads and sends

- **Runs:** the MCP server is the npm package [`@shoujiki-panman/session-relay`](https://www.npmjs.com/package/@shoujiki-panman/session-relay), pinned to an exact version and started with `npx`. The source is in this repository.
- **Reads:** your own session logs on this machine — `~/.claude/projects` (Claude Code) and `~/.codex/sessions` (Codex) — and conversations you deposited yourself in `~/.local/share/session-relay/inbox`.
- **Runs locally:** read-only `git` commands (`rev-parse`, `branch --show-current`, `log --oneline -n 10`, `status --short`) in the project folder of the conversation it loads, so the handoff shows what the repository actually looks like.
- **Writes:** a cache of the conversation list in `~/.cache/session-relay/list.json`, and, when you open a deposited conversation, a read marker in `~/.local/share/session-relay/read-at`. Nothing else.
- **Sends:** nothing. The MCP server makes no network requests. Conversations are returned only to the Claude session you are using.

The optional extras in the full package (a `/clear` hook, a deposit box you can reach from your phone through your own Cloudflare Tunnel, and a "good time to clear" hint that asks TypeSafe) are **not** part of this plugin. They are set up separately, by hand, as the repository README explains.

## Privacy

The plugin sends nothing anywhere and the author receives no data. The full [privacy policy](https://github.com/shoujiki-panman/session-relay/blob/main/PRIVACY.md) lists everything it reads and stores.

## Requirements

Node.js 20 or later.

## License

MIT
