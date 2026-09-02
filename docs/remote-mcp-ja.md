# Claudeモバイルから会話を預ける

普通のClaudeアプリで話していた会話を、自分のMacにあるsession-relayへ預けるための手順です。
共有サービスではありません。各利用者が自分のCloudflareアカウント、ドメイン、Macを使って
セルフホストします。

外向きのMCPにある道具は `deposit_conversation` 1つだけです。Mac内の会話を一覧したり
読み出したりする道具は公開しません。受け取った会話はMacの
`~/.local/share/session-relay/inbox/` にだけ保存します。

## 構成

```text
Claudeモバイル
    │  OAuth + MCP（書き込みだけ）
    ▼
Cloudflare Access ── Cloudflare Tunnel ── 127.0.0.1:8788/mcp
                                              │
                                              ▼
                                 ~/.local/share/session-relay/inbox/
                                              │
                                   Mac内の relay mcp だけが読む
                                              ▼
                                       Claude Code / Codex
```

## 必要なもの

- Node.js 20以降
- Claudeのカスタムコネクタを使えるアカウント
- Cloudflareで管理しているドメイン
- Cloudflare Zero Trust組織とログイン方法（One-time PINまたはIdP）
- `cloudflared`
- 外から預ける間、起動しているMac

macOSで `cloudflared` を入れる例です。

```sh
brew install cloudflared
```

## 1. session-relayを入れる

npm公開前はGitHubから入れます。

```sh
git clone https://github.com/shoujiki-panman/session-relay.git
cd session-relay
npm ci
npm run build
npm link
relay install
```

`relay install` は、見つかったClaude CodeとCodexにローカルの読み取り用MCPと
「続きから」スキルを登録します。2回目は同じ設定を重ねません。

## 2. Tunnelを作る

```sh
cloudflared tunnel login
cloudflared tunnel create relay-deposit
cloudflared tunnel route dns relay-deposit relay.example.com
```

`relay.example.com` は自分のホスト名に置き換えてください。作成時に表示されたTunnel UUIDと
credentials fileの場所を控えます。

このリポジトリの [`examples/cloudflared/config.yml`](../examples/cloudflared/config.yml) を
`~/.cloudflared/config.yml` にコピーし、3か所のプレースホルダーを自分の値へ置き換えます。

`httpHostHeader: 127.0.0.1` は削除しないでください。MCP本体がDNS rebinding対策として
localhost系以外のHostを拒むため、Tunnelからoriginへ渡すHostをここで固定しています。

## 3. Cloudflare AccessでMCPを保護する

Cloudflare Zero Trustのダッシュボードで次を設定します。画面名は更新で少し変わることがあります。

1. **Access controls → Applications** を開く
2. **Add an application** から **MCP server** を選ぶ
3. Application nameを `relay-deposit` にする
4. Public hostnameを `relay.example.com` にする
5. Access policyは自分のメールアドレスまたは自分だけのIdPグループに限定する
6. Managed OAuthを有効にする
7. 保存後、Application Audience (AUD) Tagを控える
8. Zero Trustのteam domainを確認する（`https://<team>.cloudflareaccess.com`）

許可対象を `Everyone` にしないでください。このMCPは会話をMacへ書き込めるため、公開範囲は
自分、または実際に利用させるメンバーだけに絞ります。

Cloudflareの公式手順でも、Managed OAuthを使うMCP本体が
`Cf-Access-Jwt-Assertion` を検証することが求められています。session-relayは公開鍵、issuer、
audience、RS256まで確認し、値が無ければ起動しません。

- [Cloudflare: Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [Cloudflare: Secure MCP servers](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/)

## 4. Mac側を起動する

ターミナル1で書き込み専用MCPを起動します。

```sh
export SESSION_RELAY_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
export SESSION_RELAY_ACCESS_AUD=<Application-Audience-Tag>
relay mcp-deposit-http
```

`relay deposit MCP: http://127.0.0.1:8788/mcp` と出れば起動しています。環境変数の値を
リポジトリや記事へ貼らないでください。

ターミナル2でTunnelを起動します。

```sh
cloudflared tunnel run relay-deposit
```

ローカルの生存確認です。

```sh
curl http://127.0.0.1:8788/healthz
```

次に、未認証の外部リクエストが拒否されることを確認します。

```sh
curl -i -X POST \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  https://relay.example.com/mcp
```

`401` と `WWW-Authenticate: Bearer` が返れば、Cloudflare Accessが手前で止めています。

## 5. Claudeへカスタムコネクタを追加する

まずWeb版Claudeで登録します。

1. **Customize → Connectors** を開く
2. `+` → **Add custom connector**
3. Nameを `Session Relay` にする
4. URLへ `https://relay.example.com/mcp` を入れる
5. AddまたはConnectを押す
6. Cloudflare Accessの画面で自分のアカウントを認証し、Allowする

Web/Desktopで接続したリモートコネクタは、同じClaudeアカウントのiOS／Android版でも使えます。

- [Anthropic: Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)

## 6. スマホから預ける

Claudeアプリで対象の会話を開きます。

1. 入力欄の `+` → **Connectors** を開く
2. `Session Relay` をオンにする
3. ツール `この会話をrelayに預ける` を **承認が必要** にする
4. `この会話をrelayに預けて` と送る
5. 実行確認で **一度だけ許可** を選ぶ

Claudeは、本人がこの会話で実際に打った発言を原文のまま `user_messages` に入れ、直近の決定や
回答を最大10件まで `progress` に入れます。添付ファイル本体と非表示のツールデータは送りません。

## 7. Mac側のClaude Code／Codexで続ける

ローカル側に `relay install` が済んでいれば、次のように話しかけます。

```text
スマホで預けた会話の続きをやりたい
relayの最新の続き
```

ローカルの通常MCPが `get_deposit` を呼びます。refを指定しなければ最新の投函を読みます。

## 止まったとき

### スマホにSession Relayが出ない

- Web版と同じClaudeアカウントか確認する
- Claudeアプリを最新版にする
- アプリを完全終了して再起動する
- 直らなければログアウトして、同じアカウントで入り直す

### 接続できるが保存されない

- `relay mcp-deposit-http` と `cloudflared tunnel run relay-deposit` の両方が動いているか確認する
- `curl http://127.0.0.1:8788/healthz` が通るか確認する
- Cloudflare Access policyが自分を許可しているか確認する
- team domainとAUDが、同じAccess applicationの値か確認する

### Macを閉じると使えない

現在はMac上で受け取る設計です。Macがスリープしている、ネットワークから切れている、または
2つのプロセスが止まっている間は預けられません。常駐化はまだ同梱していません。

## 保存と削除

保存先は次です。

```text
~/.local/share/session-relay/inbox/
```

ディレクトリは `0700`、ファイルは `0600` です。会話は平文JSONで保存されます。不要な投函を
消すCLIはまだありません。削除するときは対象のUUIDファイルを自分で確認してから扱ってください。

脅威モデルと既知の限界は [`SECURITY.md`](../SECURITY.md) にまとめています。

## 常駐化（Macを再起動しても投函口が開いたままにする）

手で起動したサーバーとTunnelは、再起動で黙って止まる。launchdに任せる。

1. 投函口サーバー: [`examples/launchd/com.example.relay-deposit.plist`](../examples/launchd/com.example.relay-deposit.plist)
   を自分の値に書き換えて `~/Library/LaunchAgents/` に置き、
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<ファイル名>`。
   AUDは秘密ではないが、plistは `chmod 600` にしておく
2. Tunnel: 公式の `cloudflared service install` を使う。ただし**生成されるplistには
   `tunnel run` の引数が入っておらず、そのままだと空振りで再起動を繰り返す**（実測）。
   `~/Library/LaunchAgents/com.cloudflare.cloudflared.plist` の `ProgramArguments` を
   `[cloudflared, tunnel, run, <トンネル名>]` に直してから読み込み直す
3. 検証: プロセスを `kill` しても数秒で復活すること（`KeepAlive`）と、
   `cloudflared tunnel info <トンネル名>` にコネクタが載ることを確認する

どちらもユーザーのLaunchAgentなので、**ログインしている間だけ**動く。
蓋を閉じて寝かせない設定（電源接続＋スリープ防止）は別途必要。

## つまずき: Authentication error（user/group information が取れない）

投函しようとして `Failed to fetch user/group information from the identity provider` が出るときは、
**Zero Trustにログイン方法（IdP）が実質1つも無い**状態を疑う。

MCPサーバーを登録すると `Cloudflare` というIdPが自動で入るが、これだけでは
ユーザー情報を返せずに認証が止まることがある（2026-09-02 実測）。

直し方: **Integrations → Identity providers → Add an identity provider → One-time PIN** を追加する。
メールに届く6桁コードでログインできるようになる。アプリ側が
`Accept all available identity providers` のままなら、追加するだけで選べるようになる。
