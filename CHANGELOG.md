# Changelog

## 0.4.0 - 2026-09-28

- `relay deposits show [ref]`: スマホ等から預けた会話の中身をCLIで読む（省略で最新）。MCP の `get_deposit` と同じ中身を出し、既読にする。MCPを使わないエージェント向け
- `relay doctor` がトンネルも見るようにした。受け口が生きていてもトンネルが止まっていれば ✗ を出す（2026-09-22、止まっている間も「ぜんぶ通っています」と言っていた）
  - cloudflared の LaunchAgent が動いているか（`launchctl print`）と、`~/.cloudflared/config.yml` で受け口の port に向く公開ホスト名に HTTPS で届くか
  - Cloudflare Access の 302/401/403 は「届いている」、530（1033）・接続エラー・時間切れは「届いていない」
  - ⚠️ Access を前に置いた構成では、トンネルが止まっていても縁が 401 を返す。外からの到達はトンネルの生死を示さないので、止まったことは LaunchAgent の検査で捕まえる（2026-09-24 に実測）
  - cloudflared の設定が無い人には「未設定」と出し、失敗にしない
- `relay doctor` がトンネルの接続の本数も見る（cloudflared の `/ready` の `readyConnections`、id `tunnel-ready`）。プロセスは生きているのに接続だけ落ちた（0本）を捕まえ、`--fix` の対象にする。メトリクスの場所は LaunchAgent のログから読み、`connectorId` が一致したときだけ信じる（別の cloudflared を拾わない）。決められなければ「未確認」で失敗にしない。`--fix` の確かめ直しも接続が張れるまで待つ
- `relay doctor --fix`: 落ちている受け口・トンネルを `launchctl kickstart -k` で起こし、戻るまで（最大30秒）確かめ直す
- `relay doctor --json`: 機械が読む形（各項目の id / ok / state / detail と、起こしたなら何をいつ起こしたか）
- 区切りの知らせを、会話の中身で選ぶ（任意）。`TYPESAFE_API_KEY` があるときだけ直近6往復を Jev に渡し、話が終わる合図で終わっているときだけ出す。鍵が無い・失敗したときは今までどおり（#13 #14）

## 0.3.0 - 2026-09-19

- `relay --model <名前>`: 渡す先のモデルを指定できる（重いモデルで決めて、軽いモデルで回す）。claude も codex もそのまま受け取る
- `relay hook`: Claude Codeの `/clear` の前後をつなぎ、同じ画面のまま会話だけを軽くする（`SessionEnd` と `SessionStart` の `clear` に入れる）
  - `/clear` を重ねても最初の会話が落ちないようにした（フックが入れた文脈は `hook_success` の添付として残るので、そこを読んで並べ直す）
- `relay hook` を `Stop` に入れると、会話が育ったときだけ「いま `/clear` すると軽くなる」を本人の画面に一行出す。自動では区切らない
  - 閾値は `RELAY_NUDGE_TOKENS`（既定30万）、刻みは `RELAY_NUDGE_STEP`。既定値は試算に使った値で、使いながら見直す前提
- `relay hook` を `PostToolUse` に入れると、下請け（`Agent`/`Task`）に出さずに道具を使い続けたときだけ、AIの文脈に一行知らせる
  - 既定8回。`RELAY_DELEGATE_CALLS` で変更。メインのモデル名に `fable` を含むときだけ出す
- フックは何があっても失敗させない（壊れた入力・控えなし・期限切れ・読めないときは黙る）

## 0.2.5 - 2026-09-03

- Codexの新しい記録形式（2026-09〜）に対応。本人の発話が0件になり、一覧からも消えていた
- 一覧と「続きから」を高速化（初回6.2秒→1.7秒）。原因は見出し整形の正規表現のバックトラッキング爆発
- Codexの承認確認セッションと毎ターンの前置きを一覧・索引から除外
- 発話が1件も残らない会話は一覧に出さない

## 0.2.4 - 2026-09-02

- `relay unread`: 未読の投函を1行で知らせる（起動時フック用。無ければ黙る）
- `get_deposit` で読んだ投函が既読になる（投函ファイルは書き換えず印だけ置く）
- 受信箱の一覧の並びを安定化（同じミリ秒に届いた投函でも順序が決まる）
- `relay install` が未読通知フックの設定を案内する

## 0.2.3 - 2026-09-02

- `relay doctor`: MCP登録・スキル・投函口の生存を1コマンドで検査
- `relay deposits` / `relay deposits rm <ref>`: 受信箱の一覧と削除
- Grok Build CLIの記録（chat_history.jsonl）を射影できるようになった（第一段・実機検証待ち）

## 0.2.2 - 2026-09-02

- `relay deposits`（受信箱の一覧）と `relay deposits rm <ref>`（削除）を追加
- 常駐化の手順とlaunchdテンプレを同梱（docs/remote-mcp-ja.md・examples/launchd/）

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
