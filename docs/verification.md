# 検証範囲と本番確認

## 自動テスト

`npm run check`で型チェック、TypeScriptビルド、Vitestを実行します。2026-09-30に5ファイル・33テストが成功しました。実アカウントの認証情報は使いません。

- JWT: 不正署名、壊れたトークン、期限切れ、issuer/audience不一致、scope不足、別subject、必須クレーム不足、古い発行時刻を拒否。
- 起動: 必須Secret/認証設定が不足すると拒否。本番モック・非HTTPS URLも拒否。
- 合成メール: 日本語件名・本文、MIME、HTML、添付メタデータ、未読検索、AND条件、UTC受信日、0件、カーソル、長文の続きを確認。
- TLS IMAPモック: 実際のImapFlowを一時証明書で検証し、EXAMINE、UID FETCH、BODY.PEEK、MIMEデコード、既読不変、認証失敗、タイムアウト、UIDVALIDITY変更、接続解放を確認。
- HTTP: 公式MCPクライアントでinitialize、tools/list、tools/callを確認。OAuthメタデータ・challenge・読み取り専用注釈、匿名/不正/期限切れ/他ユーザー拒否、未知ツール・不正引数・外部Origin拒否を確認。
- 秘密保護: サーバー由来の秘密/本文を含む例外を固定エラーに変換し、ログ・レスポンスへ漏れないことを確認。

ローカルでDockerビルド、設定なしコンテナの本番起動拒否（終了コード1）、モック起動入口からのHTTP呼び出しも成功しました。実行依存のnpm auditは脆弱性0件でした。CIはこれらに加え実行依存の脆弱性監査、Dockerビルド、設定なし本番起動の拒否を行います。Dockerビルド成功は、本番サービスへの疎通やOAuth設定の成功を意味しません。

## 未実施の検証

- 実際のiCloud Mailでの接続・日本語検索・各種MIME・未読不変
- Auth0テナントのCIMD登録、resource/audience、本人scope、失効・更新
- ChatGPTの実画面からのOAuth接続・3ツール呼び出し
- Fly.ioへの配置・外向きTCP 993/TLS・HTTP・コールドスタート
- GitHub Actionsのリモート実行結果（PR/Push後に利用者が確認）

## 本番の動作確認手順

1. SecretとAuth0を設定した後、実ホストで[TCP 993 / TLS確認](deployment.md)を実行します。`/healthz`も確認します。
2. 公開`/.well-known/oauth-protected-resource/mcp`のresourceとAuth0 issuer、scopeを確認します。Auth0の公開メタデータのissuer、PKCE S256、CIMD、トークンendpointを確認します。
3. OAuthなしの`POST /mcp`が401とWWW-Authenticateを返し、メール情報を含まないことを確認します。不正・期限切れ・別subjectでも拒否されることをMCP Inspectorまたは安全なテスト環境で確認します。実トークンを履歴・ログ・Issueに貼りません。
4. MCP InspectorまたはChatGPTで本人としてOAuth接続します。署名済みaccess tokenのaudienceがPUBLIC_URL、scopeがmail:read、subが許可subjectであることを、安全なローカル手段で確認します。オンラインJWT解析サイトには貼りません。
5. initializeとtools/listで3ツールとreadOnlyHint、securitySchemesを確認します。list_mailboxesで本人のフォルダ一覧を取得します。
6. 自分で用意した無害な日本語・テキスト/HTML・長文・添付付きメールを検索します。件名・From・To・受信日UTC・未読条件を確認し、0件ページとnext_cursor、本文next_offsetの最後まで試します。添付は名前/型/サイズだけで内容が返らないことを確認します。
7. メールクライアントで対象を未読にして状態を控え、検索・本文取得後も未読が維持されることを確認します。
8. 別のAuth0ユーザー（テスト用）がログインしても403で本人のメールを返さないことを確認します。Auth0全ユーザーにメールを開放していないことを確認します。
9. Fly.ioのアプリログに本文・宛先・Secret・トークン・IMAPエラー原文がないことを確認します。HTTPヘッダー/本文の診断ログは有効にしません。
10. ChatGPTの接続解除、Auth0 Grant/Refresh Token取消、MCP停止、Appleパスワード失効を確認します。JWTには最大15分の失効遅延があることを確認します。

実iCloudでUIDVALIDITYを意図的に変更するためにフォルダやメールを削除しません。このケースはモックで検証し、実環境で発生した際のSTALE_IDと再検索を確認します。結果の報告では各項目を「モック確認」「実環境確認」「未実施」に分けて記録してください。
