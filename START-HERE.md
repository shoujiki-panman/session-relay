# START HERE — session-relay

新しいAIセッションを始めたら、このファイルと STATUS.md を最初に読む。
セッションを終える前に、必ず STATUS.md を今日の状態に更新する。

## これは何
- Claude Codeでやっていた作業を、**引き継ぎ書を書かずに**別のハーネス（Codex等）で続けられるようにする道具。
- やり方は「要約しない」。過去セッションの**人間の発話（原文）**を落とさず抽出し、MCP経由でどのハーネスからも引けるようにする。
- 普通のClaudeモバイル／Web会話は、本人が明示したときだけ書き込み専用MCPからMacへ預ける。
- 完成の定義だった「引き継ぎ書なしで別ハーネスが現在地を答える」は実証済み。iPhone版ClaudeからCloudflare Access経由でMacへ預け、ローカルのCodexが読める経路も実機で通った。

## いまのフェーズ
Phase 4: 公開。GitHubはPublic/MIT。README、セルフホスト手順、セキュリティ文書、Zenn記事、npm配布を整えている。

## 次の一手
公開物のチェック後、GitHubへ最新実装と文書をpushする。npmは本人の `npm login` 後に0.2.0を公開し、Zenn記事は下書き確認後に `published: true` にする。
