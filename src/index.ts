// Bootstrap — create the Bolt app (Socket Mode), register handlers, start.

import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;
import { registerHandlers } from "./gateways/slack/slack.handlers.js";
import { initStateStore, closeStateStore } from "./repositories/state.repository.js";
import { loadConfig } from "./shared/config.js";

const config = loadConfig();
initStateStore(config.stateDbPath);

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
});

registerHandlers(app);

await app.start();
console.log("⚡ workflow-ideas bot running (Socket Mode)");

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received — closing Slack connection…`);
  try {
    await app.stop();
    closeStateStore();
  } catch (err) {
    console.error("Shutdown error:", err);
  }
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
