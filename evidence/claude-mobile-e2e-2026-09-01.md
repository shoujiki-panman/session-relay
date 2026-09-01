# Claudeモバイル → Mac → Codex 実機確認（2026-09-01）

個人の会話本文、メールアドレス、Cloudflareのteam domain、AUD、Tunnel UUIDは記録しない。

## 確認した経路

```text
Claude Web / iOS
  → Cloudflare Access Managed OAuth
  → Cloudflare Tunnel
  → relay mcp-deposit-http（127.0.0.1:8788）
  → ~/.local/share/session-relay/inbox/
  → relay mcp の get_deposit
```

## 1. Web版Claudeで合成データを投函

本人の発話を1件だけ含む接続テスト用の会話を作り、カスタムコネクタ `Session Relay` の
`deposit_conversation` を **一度だけ許可** した。

結果:

- Claudeが保存成功とrefを返した
- Mac側に新しいUUIDのJSONが1件できた
- `title`、`source: claude-web`、`userMessages` 1件が送信内容と一致した
- inboxディレクトリは `0700`、JSONファイルは `0600`

## 2. iPhone版Claudeから実会話を投函

同じClaudeアカウントのiPhoneアプリで `Session Relay` が表示されることを確認した。
ツール権限は **承認が必要** のままにし、普通のClaude会話から
`この会話をrelayに預けて` と依頼した。

結果:

- `source: claude-mobile` のJSONがMacへ届いた
- 本人の発話1件、直近の経過6件を受信した
- 会話本文を画面へ出さず、件数、source、時刻、ファイル権限だけで到着を確認した
- Mac側の通常MCPから、refなしの `get_deposit` で最新として読める状態になった

## 3. 拒否経路

公開URLへAccess tokenなしで `tools/list` をPOSTした。

結果:

- HTTP `401`
- `WWW-Authenticate: Bearer`
- OAuth protected resource metadataへの案内あり

origin側の自動テストでは次も確認している。

- Access JWTなしは `403`
- 無効なAccess JWTは `403`
- localhost系でないHostは `403`
- 外向きMCPに見える道具は `deposit_conversation` 1つだけ

## 4. 回帰チェック

```text
lint: pass
typecheck: pass
test files: 21 passed
tests: 241 passed
```

HTTPテストはloopback portを使うため、ローカルlistenを許可した環境で実行した。

## 結論

普通のClaudeモバイル会話を、本人の明示操作とツール承認を経て、自分のMacへ書き込み専用で預け、
ローカルのClaude Code／Codexから読み直す経路が実機で通った。

未解決なのは常駐化、認証済み利用者ごとのレート制限、npm公開である。
