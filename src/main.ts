import { loadConfig } from "./config.js";
import { createVerifier } from "./auth.js";
import { ICloudSession } from "./imap.js";
import { MailService } from "./mail.js";
import { mockState, MockSession } from "./mock.js";
import { createApp } from "./server.js";
async function main() {
  const config = loadConfig(process.env);
  const state = config.mode === "mock" ? await mockState() : undefined;
  const mail = new MailService(() =>
    state ? new MockSession(state) : new ICloudSession(config),
  );
  const app = createApp(config, mail, createVerifier(config));
  const server = app.listen(config.port, "0.0.0.0", () =>
    console.info("MCPサーバーを起動しました。"),
  );
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on("error", () => {
    console.error("HTTPサーバーを起動できません。");
    process.exitCode = 1;
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      server.close();
      setTimeout(() => process.exit(0), 25_000).unref();
    });
}
main().catch(() => {
  console.error("起動を拒否しました。READMEの必須設定を確認してください。");
  process.exitCode = 1;
});
