// Seed a test channel with sample messages so the bot has context to read.
//
// Usage:
//   SEED_CHANNEL=C0123456789 npm run seed
//   (optionally) SEED_FILE=samples/seed-messages.txt SEED_DELAY_MS=400
//
// ใช้ SLACK_BOT_TOKEN เดิม ยิง chat.postMessage ทีละข้อความเข้า channel ที่ระบุ
// บอทอ่าน context ผ่าน conversations.history ซึ่งดึง text ของทุกข้อความ
// ไม่สนผู้โพสต์ เลย seed ด้วย bot เองได้

import "dotenv/config";
import { readFileSync } from "node:fs";
import { WebClient } from "@slack/web-api";

const channel = process.env.SEED_CHANNEL;
const file = process.env.SEED_FILE ?? "samples/seed-messages.txt";
const delay = Number(process.env.SEED_DELAY_MS ?? 400);

if (!channel) {
  console.error("ต้องระบุ SEED_CHANNEL (channel id เช่น C0123456789)");
  console.error("หา id ได้จาก: คลิกชื่อ channel ใน Slack > ล่างสุดมี Channel ID");
  process.exit(1);
}

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

const lines = readFileSync(file, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Seeding ${lines.length} ข้อความ → ${channel}\n`);
  for (const [i, line] of lines.entries()) {
    // "persona: text" → แสดงเป็น *persona*: text ให้ดูเหมือนหลายคน
    const m = line.match(/^([\w]+):\s*(.*)$/);
    const text = m ? `*${m[1]}*: ${m[2]}` : line;
    await client.chat.postMessage({ channel: channel!, text });
    process.stdout.write(`  [${i + 1}/${lines.length}] ✓\n`);
    await sleep(delay); // กัน rate limit + ให้ timestamp ต่างกัน
  }
  console.log("\nเสร็จ! ไปพิมพ์ /workflow-ideas ใน channel นั้นได้เลย");
}

main().catch((e) => {
  console.error("ล้มเหลว:", e.data?.error ?? e.message);
  console.error("เช็ค: บอทอยู่ใน channel แล้วยัง + มี scope chat:write");
  process.exit(1);
});
