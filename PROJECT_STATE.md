# Project State — Workflow Ideas Bot

สรุปสิ่งที่ทำไปแล้ว + การตัดสินใจที่ล็อกแล้ว ไว้แปะเป็น context ตอน prompt ครั้งต่อไป
(อัปเดตล่าสุด: 2026-06-23)

## โปรเจกต์นี้คืออะไร
Slack bot ที่ user trigger เอง (`/workflow-ideas`) → อ่าน context ของ channel → deep-interview
แบบเจาะจง (ไม่ถาม generic) → เสนอ workflow ideas ที่ implement ได้จริง → ลงมือทำใน Slack
สถาปัตยกรรมแบบ agentic (LLM tool-calling loop)

## สถานะตอนนี้
- โค้ดรันได้แล้ว (Socket Mode + OpenRouter) — `/workflow-ideas` → อ่าน context → สรุป → เริ่ม interview ทำงานครบ
- unit test ผ่าน 6/6 (logic ของ catalog filter + idea validation)
- **ยังไม่ได้** ทดสอบ full flow end-to-end ใน Slack จริง และยังไม่ได้รัน `tsc` กับ deps จริง (sandbox ลง npm ไม่ได้)

## การตัดสินใจที่ล็อกแล้ว (จาก grilling)
1. **Agentic bar** = tool-using within Slack (ทำ action ในขอบเขต Slack ไม่ใช่แค่คุย)
2. **Control flow** = hybrid — โครง scripted (trigger→interview→propose) + LLM เลือก tool เองในแต่ละ phase
3. **Tool set** = ครบทั้ง read / interview / write
4. **Approval** = tiered — read + write ที่ self-contained รันเลย, action ที่คนอื่นเห็น (เช่น scheduled post) ต้อง confirm ก่อน
5. **Async/state** = persist-and-resume, re-entrant, เก็บ state keyed by `thread_ts`
6. **Interview termination** = confidence + hard ceiling (max 4 คำถาม) + ปุ่ม Skip
7. **Idea grounding** = constrained catalog + ต้อง cite evidence, **validate แบบ deterministic ไม่ใช่ถาม LLM**
8. **Context ingestion** = retrieve + summarize, เปิดเผยว่าอ่าน channel (disclosure-on-trigger)
9. **Catalog** = discovered = static catalog ∩ หลักฐานที่เจอใน channel
10. **Build depth** = mixed per-block — block ใน Slack ทำจริง, block นอก Slack คืน snippet

## การตัดสินใจด้าน implementation
- **Stack**: Slack Bolt + TypeScript, Socket Mode (ไม่ต้องมี public URL)
- **LLM**: ผ่าน **OpenRouter** (OpenAI-compatible SDK), ไม่ใช่ Anthropic SDK ตรง — เพราะ OpenRouter ไม่มี `/v1/messages`
  - tool-calling format = OpenAI (`tool_calls` / `tool` messages)
  - เปลี่ยน model ที่ `.env` → `OPENROUTER_MODEL` (default `anthropic/claude-opus-4.8-fast`)
  - ⚠️ slug เก่า `anthropic/claude-3.5-sonnet` ใช้ไม่ได้แล้ว (404) ปัจจุบันใช้ตระกูล opus-4.8 / fable-5
- **State store**: JSON ไฟล์ต่อ thread (`.state/`) — ตั้งใจให้ swap เป็น SQLite ทีหลัง interface เดิม
- **Catalog**: static list 6 block (slack_scheduled_message, slack_canvas, slack_workflow_step, incoming_webhook, github_action, cron_script)

## โครงสร้างไฟล์
```
src/
  app.ts       Bolt wiring: /workflow-ideas + buttons
  agent.ts     re-entrant agent loop (suspend/resume)
  prompts.ts   tool schemas (OpenAI format) + system prompt
  llm.ts       OpenRouter client + chat()
  context.ts   อ่าน + summarize channel
  catalog.ts   building blocks + evidence filter
  ideas.ts     idea schema + deterministic validation
  build.ts     "Build this" per block (execute vs hand-back)
  slackui.ts   Block Kit cards
  state.ts     persist/resume store
  types.ts     ConvState, Idea, PendingInterrupt (สัญญากลาง)
manifest.yaml  Slack app manifest
samples/eng-payments-channel.md   transcript ตัวอย่างไว้ทดสอบ context
backlog.md     แบ่งงาน 2 คน
workflow-ideas-bot-spec.md   design spec เต็ม
```

## งานหลักที่ยังเหลือ (ดู backlog.md ละเอียด)
- ทดสอบ end-to-end ใน Slack จริง + รัน `tsc` typecheck
- Refine loop ให้ทำงานจริง (ตอนนี้ปุ่ม Refine แค่โพสต์คำถาม)
- Build this ให้ครบทุก block + tiered approval flow เต็ม
- อัปเกรด state เป็น SQLite, error handling, mock mode สำหรับ demo

## เรื่องที่ตั้งใจไม่ทำ (out of scope)
OAuth เข้า GitHub/Jira, autonomous monitoring (ไม่ต้อง trigger), RAG over full history, multi-process scale-out
