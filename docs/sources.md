# 公式仕様確認記録

確認日: 2026-09-30。以下の資料を取得・確認して実装しました。サービスの設定完了や接続成功を意味するものではありません。

| 出典 | 確認・反映した事項 |
| --- | --- |
| [OpenAI MCP server](https://developers.openai.com/plugins/build/mcp-server) | 公式SDK、Streamable HTTP、ツール、注釈、HTTPS運用、テスト |
| [OpenAI Auth](https://developers.openai.com/plugins/build/auth) | OAuth 2.1、PKCE S256、protected resource metadata、issuer、resource/audience、CIMD/クライアント登録、JWT検証、securitySchemes、401 challenge、ツール認証エラー |
| [OpenAI公式Auth0 scaffold](https://github.com/openai/openai-mcpkit/blob/main/python-authenticated-mcp-server-scaffold/README.md#2-configure-auth0-authentication) | Auth0 API、RS256、CIMD手動登録、アプリごとのAPI許可 |
| [Auth0 MCP quickstarts](https://auth0.com/ai/docs/mcp/get-started/overview) | 認可サービスの構成・MCPクライアントとの連携 |
| [Auth0 Resource Compatibility Profile](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile) | resource→audience、Include Issuer in Authorization Responsesの設定 |
| [Apple iCloud Mail](https://support.apple.com/102525) | IMAP `imap.mail.me.com`、993、SSL/TLS、ユーザー名は通常localpart、必要なら完全なアドレス、アプリ用パスワード |
| [Appleアプリ用パスワード](https://support.apple.com/102654) | 生成・失効、2ファクタ認証、通常パスワードとの区別 |
| [Fly.io構成](https://fly.io/docs/reference/configuration/) | Docker、http_service、8080内部ポート、HTTPS、チェック、自動停止/開始 |
| [Fly.ioネットワーク](https://fly.io/docs/networking/) / [egress](https://fly.io/docs/networking/egress-ips/) | 公開HTTP/TCPサービス・外向き通信。実際のTCP 993到達性は配置先で確認が必要 |

実装時に公式MCP SDK 1.31.0、ImapFlow 2.1.2等を導入し、正確な依存は`package-lock.json`に固定しています。ImapFlowの`mailboxOpen({readOnly:true})`がEXAMINE、downloadのFETCHがBODY.PEEKとなることを実装とTLSモックで確認しました。

OpenAIのプロフィール識別ツールはアカウントラベル/重複検出を改善する追加機能です。初版は指定されたメール用3ツールを提供し、プロフィールツールは宣言していません。接続の本人認可はJWT issuer/subで実施します。
