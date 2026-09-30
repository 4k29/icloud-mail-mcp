# 配置・ChatGPT接続・停止

## 選んだ構成

Fly.ioのDockerコンテナ1台を使います。公式資料で公開HTTPサービス（HTTPS終端→内部8080）とMachinesの外向きネットワークを確認しました。IMAPはコンテナから外向きTCP 993/TLSで接続します。通常のクラウドVM/コンテナで動くため、Macや個人PCの常時起動に依存しません。DB/ボリュームは不要です。

Fly.io資料：<https://fly.io/docs/reference/configuration/>、<https://fly.io/docs/networking/>、<https://fly.io/docs/networking/egress-ips/>、Secret：<https://fly.io/docs/apps/secrets/>。

**このタスクでは契約・アプリ作成・公開はしていません。** Fly.ioは料金・支払い設定が必要な場合があります。Auth0の必要な機能もテナント/プランで確認してください。以下のコマンドは利用者が公開を決めた後に実行する手順です。実ホストからTCP 993が通ることは、下の事前確認で初めて検証済みになります。

Codex Cloudは開発環境です。本番のホストには使いません。この開発環境の外向きTCP権限ではiCloudへの直接接続は許可されていないため、ここで本番の到達性を検証したとは報告しません。GitHub Pagesなどの静的ホスティングだけではこのサーバーは実行できません。

## 事前準備と起動

1. [Auth0設定](authentication.md)を確認し、必要なプラン/機能を使えることを確認します。
2. Fly.ioのアカウント・CLIを本人が用意します。`fly.toml`の`app`を一意のアプリ名へ変え、リージョンを選びます。公開予定URLを決め、Auth0 API Identifierと`PUBLIC_URL`を一致させます。
3. リポジトリで`npm ci && npm run check`を実行します。`docker build -t icloud-mail-mcp .`でビルドできます。ネットワークがプロキシCAを要求する開発環境では`--secret id=proxy_ca,src=証明書パス`も渡してください。TLS検証を無効にしません。
4. `fly launch --no-deploy --ha=false`で既存の`fly.toml`を利用します。DBやRedis/ボリュームは追加しません。CLIの表示内容・料金・アプリ名を確認してください。
5. `.env.example`を`.env`へコピーし、権限を600にします。本人だけが使うエディターで設定値を入れます。`OAUTH_ISSUER`、`OAUTH_ALLOWED_SUBJECT`、`PUBLIC_URL`、iCloudの2つのSecretを設定します。`.env`をsourceしたり、ログへ表示したりしません。
6. `fly secrets import < .env`でSecretを登録します。実値をコマンド引数へ直接貼らず、履歴・チャット・PRに残しません。登録後は不要なローカル`.env`を削除します。
7. `fly deploy --ha=false`で1台を配置します。`fly scale count 1`で台数を確認・揃えます。複数台にすると接続上限は台数分増えるので、初版では1台とします。
8. 公開HTTPSの`/healthz`を確認します。これはプロセスの健全性だけで、iCloudやOAuth疎通の成功を意味しません。`fly.toml`は無通信時に停止・HTTPアクセスで再起動する設定です。コールドスタートが接続に支障を出す場合は、費用を確認したうえで常時1台へ設定を変えます。

## 外向きTCP 993の実ホスト確認

本人が`fly ssh console`でコンテナに入り、次を実行します。認証情報を使わず、DNS・TCP・TLS証明書検証までを確認します。メールやサーバー応答を表示しません。

```bash
node --input-type=module <<'JS'
import tls from 'node:tls';
const socket = tls.connect({ host: 'imap.mail.me.com', port: 993,
  servername: 'imap.mail.me.com', rejectUnauthorized: true, minVersion: 'TLSv1.2' });
socket.setTimeout(8000, () => socket.destroy(new Error('timeout')));
socket.once('secureConnect', () => { console.log('TCP 993 / TLS検証成功'); socket.destroy(); });
socket.once('error', () => { console.error('TCP 993 / TLS確認失敗'); process.exitCode = 1; });
JS
```

失敗した場合はホストの外向きネットワーク・DNS・ファイアウォールを確認し、ChatGPTへの接続を完了扱いにしません。Appleの証明書検証を無効にして回避しません。通常は固定egress IPを契約する必要はありません。到達性やApple側の制限がある場合はホストとAppleの公式情報を確認してください。

## ChatGPTへの接続

1. [Auth0](authentication.md)のCIMD・Resource Compatibility・許可ユーザー設定を完了します。
2. 対象のChatGPTアカウント/ワークスペースで、developer modeまたは現行のプラグイン作成画面を利用します。画面名称や利用可能な機能はプラン・ワークスペースで異なります。
3. MCP URLとして`https://あなたのアプリ.fly.dev/mcp`、認証としてOAuthを指定します。固定トークンやiCloudパスワードを入力する方式は使いません。
4. 必要なら画面が示すCIMD URL/クライアント情報をAuth0へ登録し、指定されたリダイレクトURLをそのまま使います。接続画面のOAuth debuggingでメタデータ、PKCE S256、resource、issuer、scopeを確認します。
5. 自分のAuth0ユーザーでログイン・同意し、3つのツールが見えることを確認します。[利用指示](plugin-instructions.md)を設定します。
6. [本番検証](verification.md)を実施します。initialize成功だけでメール機能の成功と判断しません。

非公開の個人用接続が対象です。古いChatGPT Pluginsの`ai-plugin.json`方式や公開ディレクトリへの投稿は行いません。OpenAI APIキーも不要です。

## 解除と停止

- ChatGPTの接続済みプラグイン/Appsから接続を解除し、Auth0のGrantとRefresh Tokenを失効します。
- 緊急時は先にFly.ioアプリを停止します（例: `fly scale count 0`。自動開始設定と停止状態も管理画面で確認）。再起動されないようHTTPサービス/自動起動の停止も確認するか、アプリを削除します。アプリ削除は利用者自身が影響を確認して行います。
- Apple Accountでこのアプリ用パスワードを失効します。
- `fly secrets unset ICLOUD_IMAP_USERNAME ICLOUD_APP_PASSWORD OAUTH_ALLOWED_SUBJECT`でSecretを削除できます。設定不足で起動を拒否する状態になります。
- OAuth JWTは最大15分まで有効な可能性があります。接続解除だけで即時遮断されると考えないでください。

更新時はチェックを通してからDockerイメージを再配置し、ChatGPTのツールメタデータを更新して再確認します。認証設定を変えた場合は再接続を実施します。
