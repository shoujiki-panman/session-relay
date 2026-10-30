# Alexa+から会話を預ける

Alexa+（英語）で話した内容を、自分のMacのsession-relayへ預けるための手順です。
続きはMacのClaude CodeやCodexで「続きから」と言えば拾えます。

Claudeモバイル用の投函口（[remote-mcp-ja.md](remote-mcp-ja.md)）とは**別の入口**です。
道具は同じ `deposit_conversation` 1つだけで、受け取った会話も同じ
`~/.local/share/session-relay/inbox/` に入ります（出典は `alexa`）。

> **2026年9月時点の制約**: Alexa+のMCP連携は米国・英語（en-US）のみです。
> 日本のEchoからは呼べません。動作確認はAlexa+のWebシミュレーターで行います。
> 日本語で日常的に使う入口は、Claudeモバイル用の投函口のほうです。

## なぜ別の入口にするのか

Claude用の投函口はCloudflare AccessのManaged OAuthで守っています。Alexa+はこれに乗れません。

| Alexa+の決まり | Cloudflare Access |
|---|---|
| 事前に発行したclient ID／secretでOAuth 2.1（PKCE S256）。動的クライアント登録（DCR）は使えない | ClaudeはDCRで自動登録している |
| 未認証の401に `WWW-Authenticate` を付けてはいけない | Accessは自動で付ける |

そこで、Alexa+用はAmazon Cognitoでログインさせ、MCP本体がCognitoのアクセストークンを検証します。
Accessは掛けません。

## 構成

```text
Alexa+（米国・英語）
    │  OAuth 2.1 + PKCE（Cognito）／ MCP（書き込みだけ）
    ▼
Cloudflare Tunnel（別ホスト名・Accessなし）── 127.0.0.1:8789/mcp
                                                  │  Cognitoのtokenを検証
                                                  ▼
                                 ~/.local/share/session-relay/inbox/
```

MCP本体が確かめること（どれか1つでも外れたら401）:

- 署名が自分のユーザープールの公開鍵で正しい／発行元（`iss`）が自分のプール
- `token_use` が `access`（IDトークンは不可）
- `client_id` がAlexa用に作ったアプリクライアント
- `scope` に `relay/deposit` を含む
- `sub` が `SESSION_RELAY_COGNITO_ALLOWED_SUBS` に書いた本人

## 1. Cognitoを用意する

AWSコンソールの Amazon Cognito で行います。リージョンはどこでも構いません（例: `ap-northeast-1`）。

1. **ユーザープールを作る**
   - サインインはメールアドレス
   - **セルフサインアップ（自己登録）は無効にする**。他人がアカウントを作れないようにするため
2. **自分のユーザーを1人だけ作る**。作成後に表示される `sub`（ユーザーID）を控える
3. **ドメインを設定する**（Cognitoドメインで可）。`https://<prefix>.auth.<region>.amazoncognito.com` を控える
4. **リソースサーバーを作る**
   - 識別子: `relay`
   - カスタムスコープ: `deposit` → 使うときの名前は `relay/deposit`
5. **アプリクライアントを作る**
   - 種類: 機密クライアント（クライアントシークレットあり）
   - OAuthの許可タイプ: 認可コード付与（Authorization code grant）
   - スコープ: `relay/deposit`
   - 許可されたコールバックURL: 手順4でAlexa側に表示されるRedirect URLを**すべて**登録する
   - client IDとclient secretを控える

## 2. Macで入口を起動する

```sh
export SESSION_RELAY_COGNITO_USER_POOL_ID=ap-northeast-1_XXXXXXXXX
export SESSION_RELAY_COGNITO_CLIENT_ID=<アプリクライアントID>
export SESSION_RELAY_COGNITO_DOMAIN=https://<prefix>.auth.<region>.amazoncognito.com
export SESSION_RELAY_COGNITO_ALLOWED_SUBS=<自分のsub>
export SESSION_RELAY_ALEXA_PUBLIC_URL=https://alexa-relay.example.com/mcp
# 任意: export SESSION_RELAY_ALEXA_PORT=8789 / SESSION_RELAY_COGNITO_SCOPE=relay/deposit

relay mcp-deposit-alexa
```

どれか1つでも欠けていたら起動しません（公開してから守りが無いことに気づくのを防ぐため）。

## 3. Cloudflare Tunnelに別ホスト名を足す

既存のトンネルの `~/.cloudflared/config.yml` に1行足します。

```yaml
ingress:
  - hostname: relay.example.com          # Claude用（既存・Accessあり）
    service: http://127.0.0.1:8788
    originRequest:
      httpHostHeader: 127.0.0.1
  - hostname: alexa-relay.example.com    # Alexa+用（新規・Accessなし）
    service: http://127.0.0.1:8789
    originRequest:
      httpHostHeader: 127.0.0.1
  - service: http_status:404
```

- `httpHostHeader: 127.0.0.1` は消さないでください（DNS rebinding対策でlocalhost以外のHostを拒むため）
- **このホスト名にはCloudflare Accessのアプリケーションを作らない**でください。作ると401に `WWW-Authenticate` が付き、Alexa+が繋がりません

外から確かめます。

```sh
curl -s https://alexa-relay.example.com/.well-known/oauth-authorization-server
curl -si -X POST https://alexa-relay.example.com/mcp | head -5
```

1つ目でCognitoの `authorization_endpoint` が見え、2つ目が `401` で
`WWW-Authenticate` ヘッダーが**無い**ことを確認します。

## 4. Alexa+に登録する

Amazon Developerアカウントで `alexa-ai` CLIを使います（Claude Code等なら公式のAdd-on Agent Skillでも可）。

```sh
alexa-ai configure
alexa-ai new mcp --name "Relay" --locale en-US --mcp-server-url "https://alexa-relay.example.com/mcp"
```

`addon-package/addon.json` の例文とアカウントリンクを埋めます。

- examplePhrases: `"Save this conversation to relay"`, `"Relay this to my computer"`
- アカウントリンク（Authorization code grant）
  - Authorization URI: `https://<prefix>.auth.<region>.amazoncognito.com/oauth2/authorize`
  - Access Token URI: `https://<prefix>.auth.<region>.amazoncognito.com/oauth2/token`
  - Client ID／Secret: 手順1-5の値
  - Scope: `relay/deposit`
  - 表示されたRedirect URLは、Cognitoのコールバックに全部登録する

```sh
alexa-ai deploy
```

Webシミュレーターで、何か相談したあと「Save this conversation to relay」と言います。
Macで `relay deposits show` を打つか、Claude Codeで「続きから」と言って、出典 `alexa` の会話が読めれば完成です。

## 未確認のこと（最初の実機テストで確かめる）

- 日本のAmazon DeveloperアカウントでAlexa+のシミュレーターとMCP Toolkitが使えるか
- Alexa+が付ける `resource` パラメーターをCognitoが受け付けるか（無視されれば問題なし）
- 応答0.5秒以内の要件。Alexa（米国）→Cloudflare→自宅のMacで間に合うか。Macがスリープ中は落ちる
