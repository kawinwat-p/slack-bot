// Bootstrap — create the Bolt app (Socket Mode), register handlers, start.

import "dotenv/config";
import pkg from "@slack/bolt";
const { App } = pkg;
import { registerHandlers } from "./gateways/slack/slack.handlers.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

registerHandlers(app);

await app.start();
console.log("⚡ workflow-ideas bot running (Socket Mode)");

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received — closing Slack connection…`);
  try {
    await app.stop();
  } catch (err) {
    console.error("Shutdown error:", err);
  }
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
