# session-relay

[![CI](https://github.com/shoujiki-panman/session-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/shoujiki-panman/session-relay/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/%40shoujiki-panman%2Fsession-relay)](https://www.npmjs.com/package/@shoujiki-panman/session-relay)

**AIとの会話を、引き継ぎ書を書かずに別のスレッド／別のハーネスへそのまま移す。**

会話が利用制限で止まったら、新しいチャットに「**続きから**」と打つだけ。
止まった画面のスクショを貼っても、「キャンバスの話の続き」のような曖昧な言い方でも通じます。
新しいAIが前の会話を自分で読みに行き、**あなたが実際に打った言葉の原文**を受け取って途中から再開します。
要約は挟みません。

こんな人のための道具です。

- 利用枠やチャットの長さで、AIとの会話がよく止まる
- Claude CodeとCodexのように、複数のAIツールを行き来している
- スマホのClaudeで考えごとをして、続きはMacでやりたい
- 止まるたびに「いまの状況をまとめて」と引き継ぎ書を書かせるのに疲れた

仕組み: Claude CodeとCodexが手元に残すネイティブ履歴を直接読みます。普通のClaudeモバイル／Web会話は、
本人が「relayに預けて」と明示したときだけ、書き込み専用のリモートMCPから自分のMacへ預けられます。
作った経緯は[Zenn記事](https://zenn.dev/shoujiki_panman/articles/session-relay-no-handoff)にまとめました。

> **配布状況（2026-09-02更新）**: npmで公開済みです。
> 作者が運営する共有サーバーはありません。モバイル投函口は各利用者が自分のCloudflareとMacへ
> セルフホストします。

## 最短で試す

Node.js 20以降が必要です。現在の実機確認はmacOSで行っています。

```sh
npm install -g @shoujiki-panman/session-relay
relay install
```

git cloneで開発版を使う場合は、`bin/relay.js` が `src/` の `.ts` を直接読むため
**Node.js 22.18以降**が要ります（npm版はビルド済みの `dist/` を使うので20で動きます）。

新しいClaude Code／Codexの会話で、次のように話しかけます。

```text
続きから
キャンバスの話の続きをやりたい
前の会話で私が実際に打った言葉を3つ、原文のまま
```

スマホの普通のClaude会話まで繋ぐ場合は、
[`docs/remote-mcp-ja.md`](docs/remote-mcp-ja.md) のCloudflare Tunnel＋Access手順へ進んでください。

## なぜ要るのか

会話が長くなると、引き継ぎ書を書かせて次のセッションに渡す。あれが面倒で、しかも抜ける。

実データで測ったところ、**引き継ぎ書は事実は残すが、本人の原文を落とす**。
落ちるのは温度と地雷——何に苛立ち、何に興味を示し、何を「もうやらない」と言ったか。
次のセッションはそれを知らないまま、同じ提案を蒸し返す。

## やり方: 要約しない。「射影」する

要約は、何が残って何が落ちるかが毎回変わる。射影は**定義で決まる**。

| 残すもの | 落とすもの |
|---|---|
| 人間の発話（**全件・原文のまま**） | AIの発言（ターンの最後を除く） |
| 各ターンの最後にAIが報告したこと（直近10ターン） | ツールの出力 |
| 触ったファイル・実行したコマンド | 思考過程 |
| 渡した時点のgit（場所・ブランチ・コミット・未コミット） | |

**人間の発話は1件も落とさない。** 実測で、1セッション13MBのうち人間の発話は**11.8KB＝0.09%**しかない。
落とす理由がない。

足す量も測って決めた。AIの発言を全部入れると110KB、ターンの最後だけでも77KB、**直近10件なら15KB**。

## 動くと確認できていること

- 射影17KBだけを**文脈ゼロの新セッション**に渡し、プロジェクトの全体像・中止した機能とその理由（本人の原文）・**未回答の質問が残っていること**まで復元した
- 同じ射影を**Codex**（別ハーネス）に渡し、同じことを正しく答えた
- 「結果の信号」を足したあと、渡された先が**テスト件数・コミットハッシュ・作業ツリーの状態**まで正しく言えた
- 新しいセッションに **「続きから」の一言**だけ渡すと、自分で `relay --print --previous` を実行して現在地を答えた

証跡は [`evidence/`](evidence/) にある。

## 使うには

```sh
npm install -g @shoujiki-panman/session-relay   # relay コマンドが入る
```

開発版はcloneして `npm ci`（この場合はNode 22.18以降）。

手元で開発するならcloneして `npm ci`。`npm link` の代わりに
`ln -s "$PWD/bin/relay" ~/.local/bin/relay` でもよい。

### コマンド一覧と選び方

```
relay                    別のスレッドで続きから開く
relay --to codex         Codexで開く
relay --print            文脈だけ出す（貼りたいとき）
relay --print --previous 自分ではなく「直前の会話」を引く

relay --pick             その場で選ぶ（↑↓ / 打つと絞る / Enter / Esc）
relay --pick mulmo       検索語つきで開く
relay --projects         プロジェクト単位の一覧（選ぶ単位はこちら）
relay --list --in mulmo  そのプロジェクトの会話まで降りる
relay --list             いまいる場所の会話の一覧
relay --list --all       他のプロジェクトの会話も見る
relay --from 3           一覧の3番の会話を引く
relay --from c44a44e9    refで引く（番号と違い、どれだけ古くても当たる）
relay --canvas           プロジェクトと会話を .canvas に書き出す

relay install            MCPと「続きから」スキルをまとめて登録する
relay mcp                MCPサーバーとして話す（AIが自分で取りに来る）
relay --help             使い方を出す
```

**選ぶ単位は会話ではなくプロジェクト。** 会話を単位にすると、選ぶときに出るのが
「会話の切れ端」になり、どのプロジェクトの話か分からない。
`AGENTS.md` や Memory Bank が跨ぐ単位をプロジェクトにしているのと同じ理由。

`--canvas` は [JSON Canvas](https://jsoncanvas.org/)（Obsidian のキャンバス形式・MIT）を書き出す。
**こちらは画面を作らない。** `.canvas` を Obsidian の Vault に置けば、そのまま
無限キャンバスとして開き、ドラッグも矢印も既にある機能で触れる。
会話のカードには `relay --from <ref>` が書いてあるので、そこから続きに入れる。

**「続きから」だけでは、どの会話かは決まらない。** 同じ場所で複数の会話が
並行して動いていることがあるので、当てにいかず選ばせる。

```
続きをやる会話を選ぶ  （↑↓で移動 / 文字を打つと絞り込み / Enterで決定 / Escで取消）
検索: mulmo   2件

❯ 08/27 01:40  mulmoclaude    4発話  ローカルが強くなったら関係なくない
  08/27 01:30  mulmoclaude    1発話  つづきから
```

`codex resume` も `claude -r` も同じ作法——既定は選択画面、打つと絞り込め、
最新を黙って採るのは `--last` / `-c` と明示したときだけ。**表を読ませて
もう一度コマンドを打たせることはしない。**

### 同じハーネスの続きなら、標準のほうが素直

Claude Code の会話をそのまま再開したいだけなら `claude -r`（検索語も使える）で足りる。
`relay` が要るのは、**別のハーネスに渡すとき**と、**文脈を新しくして移りたいとき**。

```
  #  ref       いつ         場所           発話  何の話か
  1  e28410db  08/27 01:32  ai-samples     72  そもそも進捗管理ではなく、アプリでもなく…
  2  2a30ca86  08/27 01:32  mulmoclaude     4  ローカルが強くなったら関係なくない
  3  671ee55a  08/27 00:54  ai-samples     13  ブートキャンプで共有されたので使ってみたい…
```

一覧には**人が実際に打った会話だけ**が出る。
サブエージェントの記録（`promptSource: "sdk"`）は外している——入れると下請けの記録で埋まる。

配るのはビルド済みの `dist` だけで、`src` の `.ts` は入れていない——
**Nodeは `node_modules` の中では型を剥がさない**ので、`.ts` を配ると入れた人の環境で動かない。

`~/.claude/projects/**/*.jsonl`（Claude Code）と
`~/.codex/sessions/YYYY/MM/DD/*.jsonl`（Codex）の**両方を自動で見つける**。
同じ作業ディレクトリの会話が新しい順に並ぶので、`--previous` は
**別のハーネスで話していた直前の会話**も引ける。

中身を確かめたいときは `relay show <path>`。

どちらも**手元のファイルを読むだけ**で、どこにも送らない。

### 「続きから」の一言で発動させる

同梱のスキルを置くと、新しいセッションに **「続きから」** と打つだけで済む。
セッション自身が `relay --print --previous` を実行して前の会話を読み込む。

```sh
ln -s "$PWD/skills/relay" ~/.claude/skills/relay   # Claude Code
ln -s "$PWD/skills/relay" ~/.codex/skills/relay    # Codex（同じ形式で効く）
```

スマホから母艦のセッションに入る場合（Claude Codeの Remote Control）も、これで1手になる。
コピペもファイルの受け渡しも要らない。

### MulmoTerminal に一覧を出す（タップで続きから）

コマンドを打ちたくないとき用。会話の一覧を**見えているものから選ぶ**。

```sh
cp -R skills/relay-chats <ワークスペース>/data/skills/relay-chats
relay --records <ワークスペース>/data/relay-chats/items
```

「会話の続き」というコレクションが増える。**タップすると新しいチャットが
下書き付きで開く**（送信するのは本人。押しただけでは何も起きない）。
下書きには `get_context` を ref 付きで呼ぶ指示が入っているので、
送ればそのAIが前の会話を読み込んでから続ける。

画面は作っていない——MulmoTerminalのコレクションとカスタムビューに乗せているだけ。
一覧が古くなったら、ビューの「一覧を更新」か、チャットで「一覧を更新して」と言う。

### MCP: AIが自分で取りに来る

貼るのをやめる。MCPサーバーとして繋ぐと、**渡された側のAIが自分で文脈を取りに来る**。
一度入れたら、**コマンドは打たない**。新しいチャットで普通に話しかけるだけ。

```
「続きから」
「キャンバスの話の続きをやりたい。前にどこまで話したか教えて」
「前の会話で私が実際に打った言葉を3つ、原文のまま」
```

実測（2026-08-29・文脈ゼロの新しいセッション）: 3つとも、AIが自分で会話を探して答えた。
**番号も ref も打っていない。** 本人の言葉は `about` としてそのまま渡る。

```sh
relay install             # MCPと「続きから」スキルをまとめて登録する
relay install --dry-run   # 何をするかだけ見る
```

入っているハーネス（Claude Code / Codex）を見て登録する。**2度目は何もしない**。
入っていないハーネスには何も置かない。

手で書くなら次のとおり。**絶対パスで書くこと**——MCPサーバーを起動するのは
別のプロセスで、`~/.local/bin` が PATH に入っていないことがある。

```sh
claude mcp add relay --scope user -- /絶対パス/bin/relay.js mcp
codex mcp add relay -- /絶対パス/bin/relay.js mcp
```

通常のMCPに見える道具は5つ。AIは上から順に降りてこられる。

| 道具 | 何をするか |
|---|---|
| `get_context` | 前の会話を原文のまま返す。**引数なし**＝いまいる場所の直前の会話 |
| `list_projects` | プロジェクト単位の一覧（どの話の続きかを選ばせるとき） |
| `list_conversations` | そのプロジェクトの会話と `ref` |
| `list_deposits` | スマホ等から明示的に預けた会話の一覧 |
| `get_deposit` | ref指定、または指定なしで最新の預けた会話を返す |

`ref` を必ず書いて返している。書かないと、AIはもう一度自分で探しに行く。

### スマホの普通のClaudeチャットから預ける

Claude CodeのRemote Controlではなく、Claudeアプリで普通に始めた会話は
`~/.claude` に記録されないため、従来のrelayからは見えない。そこで、本人が
「この会話をrelayに預けて」と明示した会話だけを受け取る投函口を分けた。

```sh
relay mcp-deposit
```

このMCPに見える道具は `deposit_conversation` **1つだけ**。ローカルの会話を
一覧・閲覧する道具は置かない。預けた内容は
`~/.local/share/session-relay/inbox/` にディレクトリ `0700`・ファイル `0600` で保存する。

外向きにはこの書き込み専用MCPだけを出し、通常の `relay mcp` はローカルから出さない。

### 外から預ける（Cloudflare Tunnel + Access）

同じ投函口を、Streamable HTTPでCloudflare Tunnelの後ろに置ける。

```sh
export SESSION_RELAY_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
export SESSION_RELAY_ACCESS_AUD=<AccessアプリケーションのAudience Tag>
relay mcp-deposit-http          # http://127.0.0.1:8788/mcp（127.0.0.1にしかbindしない）
```

- **チームドメインとAUDが無ければ起動しない。** 認証なしのまま公開URLに繋がる状態を作らせない
- 受信時も `Cf-Access-Jwt-Assertion` をCloudflareの公開鍵（`/cdn-cgi/access/certs`）・issuer・audienceまで
  検証する。**Tunnelの設定を間違えても、MCP本体が拒否する**（Accessを通っただけで信用しない）
- `Host` が localhost 系でなければ拒否（DNS rebinding対策）。ポートは `SESSION_RELAY_DEPOSIT_PORT`
- 見える道具は stdio 版と同じく `deposit_conversation` **1つだけ**

**実機確認済み**（2026-09-01）: Cloudflare Tunnel＋Access Managed OAuthを通し、Web版Claudeの
合成テストとiPhone版Claudeの普通の会話をMacへ預けた。未認証の公開リクエストは401、originでは
JWTなし・無効JWT・偽Hostを403で拒否した。外向きに見える道具は1つ、保存権限はディレクトリ0700・
ファイル0600だった。個人の会話本文を除いた記録は
[`evidence/claude-mobile-e2e-2026-09-01.md`](evidence/claude-mobile-e2e-2026-09-01.md) にある。

再現手順、Cloudflare設定、Claudeモバイルでの有効化は
[`docs/remote-mcp-ja.md`](docs/remote-mcp-ja.md) を参照。脅威モデルと既知の限界は
[`SECURITY.md`](SECURITY.md) に分けた。

**標準出力はJSON-RPCで埋まっている。** 何かを知らせたいときは stderr に書くこと——
1行でも標準出力に混ざると通信が壊れる。

## いまの限界（分かっていて残していること）

- gitの欄は **relay を打ったディレクトリ**のリポジトリを映す。会話の話題と別のリポジトリのことがある（`場所:` を明記して区別できるようにしてある）
- 触ったファイルの一覧は Read/Edit/Write の入力からしか採れない。**Bashだけで作業すると空に近くなる**
- `--previous` は「自分以外で最も新しい会話」なので、**同じディレクトリで別のセッションが並行して動いていると、そちらを引く**
- **Codexの headless（`codex exec`）はMCPの呼び出しを承認せずに落とす**。実測（2026-08-28）では
  ツールを見つけて `get_context` を呼ぶところまで行くが、0秒で `user cancelled MCP tool call` になる。
  `approval_policy = "never"` でも変わらない（Codex側の判定。対話TUIなら本人が承認できる）
- **一覧の見出しは覚えている**（`~/.cache/session-relay/list.json`）。会話は終われば変わらないので、
  更新時刻が同じなら読み直さない。実測: `list_projects` **3.5秒 → 49ms**。
  中身には見出し（発話の先頭44文字）と作業ディレクトリが入る——**手元から出ない**のは他と同じ
- **`get_context` は毎回読む**（実測2.3秒）。会話は続いているので、覚えたら古くなる。ここは速くしない
- **Codexは会話を確実に特定できない**。Claude Codeは `CLAUDE_CODE_SESSION_ID` を環境変数で渡してくるが、
  Codexは渡してこない（codex-cli 0.147.0 で実測）。記録の先頭行 `session_meta` にidはあるが、
  「いま自分がどれか」は分からないので、cwd一致＋新しい順の当て推量になる
  （Codex自身も `codex resume --last` を時刻で決めているので、同じ割り切り）

## ロードマップ

- [x] **Phase 0** 引き継ぎ書の壊れ方を自分の実データで実測する
- [x] **Phase 1** 抽出器（射影）。Claude Code / Codex 両対応
- [x] **Phase 2** 結果の信号（ターンの最後・git）。渡された先が進捗を過小評価しないように
- [x] **Phase 3の入口** `relay` コマンド／ヘッダーボタン／`relay` スキル（「続きから」の1手）
- [x] **Phase 3** MCPサーバー（AIが自分で取りに来る）。Claude Code で接続を確認
- [x] **Phase 3.5** ClaudeモバイルからCloudflare Access経由でMacへ預け、Codex側から読めることを実機確認
- [ ] Codexの対話TUIで「続きから」が通ることの確認（headlessは承認で落ちる）
- [x] npm配布（2026-09-01公開・`@shoujiki-panman/session-relay` 0.2.0）
- [ ] リモート投函口の常駐化と認証済み利用者ごとのレート制限
- [ ] 索引（複数の会話から探して引く）

## 開発の決まりごと

小さいPure Functionに割り、正常系だけでなく Edge / Corner / Error まで書く。
`any` と型アサーションは禁止。複雑度10・関数40行・ファイル250行で lint が落ちる。
壊れたテストが本当に赤くなるか（Mutation Test）を手で確かめてから進める。

```sh
npm run check   # lint + 型チェック + テスト
```

このルールは実際に3回仕事をした。`!` を即座に止め、複雑度12の関数を分割させ、
二重入れ子で発話が全部消えるバグをテストが捕まえた。
