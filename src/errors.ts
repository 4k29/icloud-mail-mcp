export const messages = {
  INVALID_INPUT: "引数が不正です。",
  AUTH_REQUIRED: "OAuth認証が必要です。",
  FORBIDDEN: "アクセスが許可されていません。",
  BUSY: "同時処理数の上限です。時間をおいて再実行してください。",
  TIMEOUT: "メール取得がタイムアウトしました。",
  IMAP_UNAVAILABLE:
    "iCloudに接続できません。サーバーの接続設定を確認してください。",
  IMAP_AUTH_FAILED:
    "iCloud認証に失敗しました。サーバーのSecretを確認してください。",
  STALE_ID: "UIDVALIDITYが変わりました。検索し直してください。",
  NOT_FOUND: "メールが見つかりません。",
  BODY_TOO_LARGE:
    "本文の安全な取得上限を超えています。メールクライアントで確認してください。",
  RESPONSE_TOO_LARGE: "返却サイズの上限を超えています。条件を絞ってください。",
  INTERNAL: "処理に失敗しました。",
} as const;
export type ErrorCode = keyof typeof messages;
export class SafeError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(messages[code]);
  }
}
export function safeError(error: unknown): SafeError {
  return error instanceof SafeError ? error : new SafeError("INTERNAL");
}
