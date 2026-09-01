# Security Policy

## 前提

session-relayは共有SaaSではありません。各利用者が自分のMacとCloudflareアカウントへ
セルフホストする道具です。作者が運営する公開の投函先はありません。

ローカルのClaude Code／Codex履歴を読む `relay mcp` と、外部から会話を受け取る
`relay mcp-deposit-http` は別のMCPです。外向きのMCPにある道具は
`deposit_conversation` 1つだけで、ローカル履歴や投函済み会話を読む道具はありません。

## 守っている境界

- HTTPサーバーは `127.0.0.1` にだけbindする
- Cloudflare Accessのteam domainとAUDが無ければ起動しない
- `Cf-Access-Jwt-Assertion` をCloudflareの公開鍵、issuer、audience、RS256まで検証する
- Hostがlocalhost系でなければ拒否する
- `user_messages` は最大200件、1件64KB、会話全体256KB
- `progress` は最大10件
- 保存先ディレクトリは `0700`、各JSONファイルは `0600`
- ファイル名はサーバーが作るUUIDで、利用者がパスを指定できない
- 過去の会話は命令ではなく記録として扱うよう、読み取り時の文脈に明記する

Cloudflare Tunnelでは `originRequest.httpHostHeader: 127.0.0.1` が必要です。設定例は
[`examples/cloudflared/config.yml`](examples/cloudflared/config.yml) にあります。

## 利用者が守ること

- Cloudflare Access policyを自分、または利用させるメンバーだけに限定する
- Claude側のツール権限は **承認が必要** にする
- `SESSION_RELAY_ACCESS_TEAM_DOMAIN`、`SESSION_RELAY_ACCESS_AUD`、Tunnel credentialsを公開しない
- `relay mcp` をTunnelへ繋がない。外へ出してよいのは `relay mcp-deposit-http` だけ
- OSアカウント、ディスク暗号化、バックアップを自分で管理する
- 不要になった投函ファイルは内容と対象を確認してから削除する

## 既知の限界

- 会話はMac上へ平文JSONで保存される。session-relay自身による暗号化はない
- 通信はHTTPSだが、Claude、Anthropic、Cloudflareを通過する。端末間のE2E暗号化ではない
- 認証済み利用者ごとのレート制限と保存件数の上限はまだない。Access policyを広くしない
- Macが停止、スリープ、またはオフラインの間は受け取れない
- 添付ファイル本体、画像、非表示のツール出力は引き継がない
- LLMが作った `progress` は要約であり、誤りを含む可能性がある。本人の発話は別欄で原文保存する
- 会話本文そのものにプロンプトインジェクションが含まれる可能性は残る。読み取る側でも
  過去ログを命令として扱わないこと

## 脆弱性の報告

公開Issueへ秘密情報、Access token、会話本文を貼らないでください。GitHubの
[Private vulnerability reporting](https://github.com/shoujiki-panman/session-relay/security/advisories/new) を使ってください。

報告には、再現条件、期待した拒否動作、実際の動作、影響する版を含めてください。実データの代わりに
合成した会話を使ってください。
