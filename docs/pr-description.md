本人のiCloudメールをChatGPTから検索・閲覧できる、読み取り専用MCPサーバーを追加します。フォルダ一覧、条件検索とカーソル、本文の継続取得、添付メタデータを提供し、送信や既読化などの変更操作は含みません。

- Node.js 24 / TypeScript、公式MCP SDK、ImapFlow、MailParser、html-to-text、jose。ステートレスのStreamable HTTP `/mcp`。
- Auth0のOAuth 2.1 / PKCE / CIMDを利用するリソースサーバー。RS256・issuer・audience・期限・scope・本人subjectをHTTPと各ツール呼び出しで検証。
- EXAMINE / BODY.PEEK、フォルダ+UIDVALIDITY+UIDのID、取得・接続・応答上限、固定エラーと秘密保護。
- ローカル合成メールとTLS IMAPモック、日本語READMEと認証/Apple/ChatGPT/運用手順、Dockerfile、Fly.io設定、GitHub Actions。
- 既存の未コミットAGENTS.mdを内容を変えずに引き継ぎます。

検証：GitHub Actions（Push・PR）も成功。型チェック、ビルド、33テスト、ローカルモック入口から公式MCP HTTPクライアントによる呼び出しが成功。実行依存のnpm auditは脆弱性0件。DockerビルドとSecret不足時の本番起動拒否を確認。

未検証：実iCloud、Auth0テナント、ChatGPTのOAuth接続、Fly.io配置/外向きTCP 993。実アカウントの認証情報は使っていません。有料契約・本番公開は行っていません。利用者がAuth0のAPI/CIMD/本人subject、Appleのアプリ用パスワード、ホストのSecretを設定し、本番の確認手順を実施する必要があります。JWTの失効には最大15分の遅延があり、緊急遮断はサーバー停止とSecret/パスワード失効で行います。
