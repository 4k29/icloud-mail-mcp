# Auth0と本人限定の認可

ChatGPT→MCPはOAuth 2.1 Authorization Code + PKCE。MCP→iCloudはIMAP + アプリ用パスワードで、両者は別の認証です。サーバーはOAuth認可・ログイン・トークン交換の独自実装を持ちません。現行OpenAI公式資料で案内されているAuth0を利用します。

この手順は公式資料を基にした設定手順です。このリポジトリからAuth0テナントの作成・設定変更は実施していません。利用プラン、地域、テナントで必要な機能が使えるか先に確認してください。有料契約は別途明示的に判断してください。

## 設定順序

1. Auth0の個人用テナントを用意します。ログイン用の接続を設定し、自分のユーザーを作成/登録します。**User Management → Users → 自分のUser ID**を控えます。`auth0|...`などの不変なIDを`OAUTH_ALLOWED_SUBJECT`に設定します。メールアドレスや表示名で認可しません。
2. Applications → APIs → Create API。Identifierは本番の`PUBLIC_URL`そのもの（`https://あなたのアプリ.fly.dev/mcp`）、JWT ProfileはAuth0、署名RS256です。`mail:read` permissionを作成します。アクセストークン有効期間を**900秒以下**に設定します。本サーバーはexp - iatが900秒を超えるトークンを拒否します。
3. 本人用のRoleを作り、このAPIの`mail:read`を付与し、自分だけに割り当てます。必要に応じてAPIのRBACを有効にし、ログインフローでアクセストークンの**scope**に`mail:read`が入ることを検証します。`permissions`クレームだけでは本サーバーは許可しません。
4. Settings → Advanced → Settingsで **Resource Parameter Compatibility Profile** と **Include Issuer in Authorization Responses** を有効にします。前者でChatGPTのRFC 8707 `resource`がAPI audienceになります。後者はRFC 9207の認可応答`iss`です。
5. Settings → Advancedで **Client ID Metadata Document (CIMD) Registration** を有効にします。Auth0のOAuth Authorization Server MetadataにCIMD、PKCE S256、正しいissuer、authorization_endpoint、token_endpointが出ることを確認します。
6. ChatGPTの接続画面/プラグインビルダーが指定するCIMD URLを、Applications → Applications → Create Application → Import from URLで取り込みます。RFC 9207対応の条件を満たす場合のOpenAIの安定URLは`https://chatgpt.com/oauth/client.json`です。条件を満たさない場合はcallback固有URLが使われるため、**実画面の指定値**と公式資料を優先します。リダイレクトURLを推測したり、ワイルドカードにしたりしません。
7. APIのApplication Access Policyを**Per-app authorization**にし、インポートしたChatGPTのCIMDクライアントにUser-Delegated Accessの`mail:read`だけを許可します。全サードパーティへのデフォルト許可やClient Credentialsの許可は不要です。ログイン用接続をこのアプリで有効にします。
8. `OAUTH_ISSUER`にAuth0の公開メタデータのissuerを完全一致で設定します。通常は`https://テナント地域.auth0.com/`です。カスタムドメインの場合もissuer・JWT・メタデータを統一します。JWKSはこのissuer配下の`.well-known/jwks.json`を利用します。
9. `PUBLIC_URL`、issuer、本人subjectをサーバーのSecret/環境設定へ反映します。本番接続前に[動作確認](verification.md)を実施します。

Auth0の公式手順ではDefault Audienceの設定も案内されています。専用テナントで必要な場合はAPI Identifierを設定してください。Resource Compatibility Profileを有効にした状態で、実際の`resource`指定から正しいaudienceが発行されることを確認します。

## 本人限定の境界

ログイン成功だけではメールを返しません。サーバーはjoseで以下をHTTPリクエストと各ツール呼び出しで検証します。

- RS256署名とAuth0のJWKS
- 固定issuer、`PUBLIC_URL`と一致するaudience、exp / iat / nbfと最大15分の発行期限
- `mail:read` scope
- 検証済みissuerと`OAUTH_ALLOWED_SUBJECT`の組み合わせ

別の人が同じAuth0テナントやChatGPTクライアントにログインできても、subjectが違えば403です。メールアカウントをユーザー引数から選ぶ機能はありません。本人allowlistの最終検証はMCPサーバーが行います。

## メタデータと認証エラー

公開の`/.well-known/oauth-protected-resource`と`/.well-known/oauth-protected-resource/mcp`は、resource（`/mcp`まで含む）、Auth0 issuer、`mail:read`を宣言します。Authorization Server MetadataはAuth0が提供します。本サーバーが偽のauthorize/token/registrationエンドポイントを公開することはありません。

OAuthなし/無効なトークンにはHTTP 401 + `WWW-Authenticate: Bearer resource_metadata="...", scope="mail:read"`。本人またはscopeが不一致なら403 + insufficient_scope。ツール呼び出し時に期限切れなどが発生した場合は、`isError`と`_meta["mcp/www_authenticate"]`を返します。

任意の固定BearerをChatGPTに貼り付ける接続方法は採用しません。ローカルの合成JWTはモック検証専用です。

## アクセス解除・失効

1. ChatGPTの接続済みプラグイン/Appsの設定で接続を解除します。
2. Auth0でこのユーザー・クライアントのGrantとRefresh Token（有効なら）を取り消します。必要ならCIMDアプリへのAPI許可も取り消します。
3. JWTは発行後最大15分まで検証に通る可能性があります。即時停止が必要なら、MCPの稼働を停止し、本人subjectを削除/変更して再起動します。subjectを削除すると本番起動自体が拒否されます。
4. iCloudへのアクセスも止める場合はApple Accountからアプリ用パスワードを失効します。

OIDCのemail/profile等をAuth0がメタデータで宣言する場合、ChatGPTがそれらも要求することがあります。Auth0側で利用可能にしてください。本サーバーのメール認可はそれらの値に依存しません。プロフィール識別用の追加MCPツールは初版にはありません。
