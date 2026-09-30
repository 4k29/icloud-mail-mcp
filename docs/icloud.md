# iCloud接続とアプリ用パスワード

Apple公式資料：<https://support.apple.com/102525>、アプリ用パスワード：<https://support.apple.com/102654>。

1. iCloud Mailが有効なApple Accountを使用し、2ファクタ認証を設定します。
2. <https://account.apple.com/> に本人がログインし、「サインインとセキュリティ」→「アプリ用パスワード」から、このMCP専用のパスワードを生成します。
3. 生成した値をホスティング先の`ICLOUD_APP_PASSWORD` Secretに保存します。Apple Accountの通常のパスワードは使いません。チャット・ツール引数・Issue・PR・ログへ貼り付けないでください。
4. `ICLOUD_IMAP_USERNAME`もSecretにします。Apple公式では通常はiCloud Mailアドレスの@より前（例: `johnappleseed`）、それで接続できない場合は完全なメールアドレスを試すと説明されています。ユーザー名はこの設定で変更できます。
5. サーバーの接続先は`imap.mail.me.com`、993、TLSに固定されています。TLS証明書検証は無効にできません。

失効はApple Accountの同じ画面から、このMCP専用のアプリ用パスワードを取り消します。MCPサーバーを停止し、ホストのSecretも削除します。再利用する場合は新しいアプリ用パスワードを生成してSecretを更新し、再起動します。

Apple Accountの主パスワードを変更/リセットするとアプリ用パスワードが自動的に取り消されることがあります。接続エラーの原文やSecret値を共有せず、本人がAppleの設定を確認してください。
