# Privacy policy — session-relay

Last updated: 2026-10-07

session-relay is a tool that runs on your own computer. The author does not run any server for it and receives no data from it: no conversations, no usage statistics, no crash reports.

This policy covers the Claude Code plugin (`plugins/session-relay`) and the npm package [`@shoujiki-panman/session-relay`](https://www.npmjs.com/package/@shoujiki-panman/session-relay) it starts.

## What the plugin reads

- Your own AI coding session logs on this computer: `~/.claude/projects` (Claude Code) and `~/.codex/sessions` (Codex). These logs can contain anything you or the AI typed, including names, email addresses or other personal data.
- Conversations you deposited yourself, in `~/.local/share/session-relay/inbox`.
- The state of the git repository a conversation took place in, through read-only `git` commands (`rev-parse`, `branch --show-current`, `log --oneline -n 10`, `status --short`).

It reads these only when Claude calls one of its tools, and returns what it read only to the Claude session you are using.

## What the plugin stores

- `~/.cache/session-relay/list.json`: a list of your conversations. For each one it keeps the folder it took place in, a title (up to 44 characters of what you typed), and up to 400 characters of what you typed, lower-cased, for searching. It exists so the list does not have to be rebuilt from every log each time. Deleting it is safe; it is rebuilt when needed.
- `~/.local/share/session-relay/read-at`: which deposited conversation you opened last.

Both stay on your computer. Nothing is kept anywhere else.

## What the plugin sends

Nothing. The plugin makes no network requests. Data leaves your computer only in the way any Claude Code tool result does: what a tool returns becomes part of your Claude conversation, which is handled under [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

## Features that are not part of the plugin

The npm package has optional features that the plugin does not install or turn on. You set them up yourself, by hand, following the [README](README.md):

- **Deposit box reachable from your phone.** It runs behind a Cloudflare Tunnel and Cloudflare Access that you configure in your own Cloudflare account. Conversations you deposit travel through Cloudflare to your own computer, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- **"Good time to clear" hint.** Only when you set `TYPESAFE_API_KEY`, the last six exchanges of your conversation are sent to TypeSafe to decide whether a conversation has reached a natural break, under [TypeSafe's privacy policy](https://typesafe.ai/privacy).

## Children

session-relay is a developer tool and is not intended for people under 18.

## Changes and contact

Changes to this policy are recorded in this file's history on GitHub. Questions: open an issue at <https://github.com/shoujiki-panman/session-relay/issues>.
