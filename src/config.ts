import { z } from "zod";
const httpsUrl = z
  .string()
  .url()
  .refine(
    (s) =>
      new URL(s).protocol === "https:" &&
      !new URL(s).username &&
      !new URL(s).password &&
      !new URL(s).hash &&
      !new URL(s).search,
  );
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
    MAIL_MODE: z.enum(["icloud", "mock"]).default("icloud"),
    PORT: z.coerce.number().int().min(1024).max(65535).default(8080),
    PUBLIC_URL: httpsUrl,
    OAUTH_ISSUER: httpsUrl,
    OAUTH_ALLOWED_SUBJECT: z.string().min(1).max(256),
    ICLOUD_IMAP_USERNAME: z.string().min(1).max(320).optional(),
    ICLOUD_APP_PASSWORD: z.string().min(1).max(256).optional(),
  })
  .superRefine((e, ctx) => {
    if (
      e.MAIL_MODE === "icloud" &&
      (!e.ICLOUD_IMAP_USERNAME || !e.ICLOUD_APP_PASSWORD)
    )
      ctx.addIssue({ code: "custom", message: "iCloud Secrets required" });
    if (e.MAIL_MODE === "mock" && e.NODE_ENV === "production")
      ctx.addIssue({ code: "custom", message: "Production mock prohibited" });
  });
export interface Config {
  mode: "icloud" | "mock";
  port: number;
  resource: string;
  issuer: string;
  subject: string;
  username?: string;
  password?: string;
}
export const SCOPE = "mail:read";
export const LIMITS = Object.freeze({
  connections: 2,
  operationMs: 20_000,
  httpRequests: 16,
  bodyBytes: 1_048_576,
  responseBytes: 131_072,
  uidWindow: 200,
  mailboxes: 200,
});
export function loadConfig(env: NodeJS.ProcessEnv): Readonly<Config> {
  const r = envSchema.safeParse(env);
  // Never include schema errors: they may contain Secret input values.
  if (!r.success)
    throw new Error(
      "サーバー設定が不足または不正です。READMEの必須設定を確認してください。",
    );
  const e = r.data;
  const resource = e.PUBLIC_URL.replace(/\/$/, "");
  if (new URL(resource).pathname !== "/mcp")
    throw new Error("PUBLIC_URLはHTTPSの /mcp URLで指定してください。");
  return Object.freeze({
    mode: e.MAIL_MODE,
    port: e.PORT,
    resource,
    issuer: e.OAUTH_ISSUER,
    subject: e.OAUTH_ALLOWED_SUBJECT,
    username: e.ICLOUD_IMAP_USERNAME,
    password: e.ICLOUD_APP_PASSWORD,
  });
}
