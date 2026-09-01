# Changelog

## 0.2.1 - 2026-09-02

- セキュリティレビュー（重大0・中1・軽微2）の指摘を修正
  - 受信箱に上限100件（認証を持つ相手にもディスクを食い潰させない）
  - fs系エラーの文言（ホームのパスを含む）を外向きMCPの応答に出さない
  - /healthz の無認証応答からツール名を削除

## 0.2.0 - 2026-09-01

- Claudeモバイル／Webから会話を預ける書き込み専用MCPを追加
- Cloudflare Tunnel向けのStreamable HTTP transportを追加
- Cloudflare Access JWTを公開鍵、issuer、audienceまでoriginで検証
- ローカルMCPに `list_deposits` と `get_deposit` を追加
- inboxを `0700`、投函JSONを `0600` で保存
- リモートMCPのセルフホスト手順とセキュリティ文書を追加

## 0.1.0 - 2026-08-29

- Claude CodeとCodexのネイティブ履歴から本人の発話を抽出
- CLI、対話ピッカー、JSON Canvas、MulmoTerminal向けレコード出力を追加
- ローカルMCPと `relay install` を追加
