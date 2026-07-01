# Project State — Workflow Ideas Bot

สรุปสิ่งที่ทำไปแล้ว + การตัดสินใจที่ล็อกแล้ว ไว้แปะเป็น context ตอน prompt ครั้งต่อไป
(อัปเดตล่าสุด: 2026-07-01)

## โปรเจกต์นี้คืออะไร
Slack bot ที่ user trigger เอง (`/workflow-ideas`) → อ่าน context ของ channel → deep-interview
แบบเจาะจง (ไม่ถาม generic) → **generate workflow spec** (ไฟล์ `.md` สไตล์เดียวกับ
`workflows/morning-needs-me-digest.md`) ที่ implement ได้จริงโดยไม่ต้องถามเพิ่ม
สถาปัตยกรรมแบบ agentic (LLM tool-calling loop) + ยึดแนวทาง `/loop-me`

## Flow ใหม่ (team decision — แทนที่ flow เดิมที่เป็น idea cards)
1. user เรียก `/workflow-ideas` → โพสต์ disclosure → อ่าน recent messages ของ channel
2. **summarize context เป็น Schema (1 LLM call)** → `ContextSummary`
   { tools, summary, painPoints, **connectors** }
3. `initState` + เริ่ม **grilling** (interview loop) — ยึด `/loop-me` (relentless, ทีละคำถาม,
   ground ทุกคำถามกับ context/คำตอบก่อนหน้า) + Skip + ceiling คำถาม
4. เมื่อผ่าน **hard-gate** (มี loop จริงที่ควรทำ) → หยุด interview loop แล้ว**ส่งต่อให้
   generate/validate sub-loop** (ไม่ exit runloop)
5. **generate/validate sub-loop** (2 step, LLM คนละ call):
   - `generate-workflow` → ร่าง `.md` เต็ม
   - `validate-workflow` → LLM ตัวที่สอง cross-check ตอบ **Yes/No**
   - **No** → คืน reasoning → regenerate ใหม่ (ยังไม่มี cap) → validate ซ้ำ วนจน Yes
   - **Yes** → โพสต์ **brief + ลิงก์ `.md`** ให้ user review แล้ว **suspend** (ยังไม่ปิด session)
6. **Accept** → เขียนไฟล์ `workflows/{slug}.md` + บอก path → `phase="done"` → หยุด loop
   **Refine** → user พิมพ์ว่าจะแก้อะไร → กลับเข้า generate/validate sub-loop อีกรอบ

## การตัดสินใจที่ล็อกแล้ว (จาก grilling รอบใหม่ 2026-07-01)
1. **Deliverable** = full workflow spec (ทรงเดียวกับ `morning-needs-me-digest.md`) —
   Slack เป็นที่ review, เขียนลง `workflows/{slug}.md` ตอน **Accept** (Q1)
2. **generate + validate = sub-loop แยกต่างหาก** — มี iteration gate ของตัวเอง (uncapped)
   แยกจาก interview loop ที่มี `MAX_ITERS`/ceiling เพื่อไม่ให้ safety cap ของ interview
   มาฆ่า path regenerate ที่ตั้งใจให้ uncapped. session ไม่ปิดจน Accept (Q2)
3. **Hard-gate บาง (thin)** — แค่ "มี loop จริงที่ควรทำ" (reuse resolved-pain + impact signal เดิม)
   **ไม่ mandate โครงสร้าง** ของ spec. ความเข้มเรื่องรูปทรงไปอยู่ที่ validate-workflow
   ในรูปแบบคำถาม loop-me: *"implementer สร้างได้โดยไม่ต้องถามไหม?"* ไม่ใช่เช็กลิสต์ field (Q3)
4. **connectors = `string[]` แบน** เพิ่มใน `ContextSummary` (ยัง 1 LLM call).
   เรื่อง "ต่อได้จริงไหม" อยู่ใน **prompt** ให้โมเดลใช้วิจารณญาณถามเอง (ไม่ใส่ enum สถานะ
   เพราะจะบังคับให้โมเดลทำตามแบบหุ่นยนต์). ถ้าพลาด → validate-workflow จับทีหลัง (Q5)
5. **Yes-path UX** = brief แบบ Block Kit (header / context "แก้ pain อะไร" / fields
   Trigger·Checkpoint·Connectors / steps ย่อ 3–5 bullet / divider / ปุ่ม Accept·Refine + ลิงก์ `.md`)
   — decision-ready ตาม loop-me "อ่าน brief ไม่ใช่ draft" (Q6, UX-Q2)
6. **แก้เล็กน้อยเอง** = ไม่ทำ editor ใน Slack — Accept เขียนไฟล์แล้ว user ไปแก้ `.md` ในเรพเอง
   (ไฟล์คือ source of truth, checkpoint คือคน). ตอน Accept บอท**บอก path/ลิงก์**ให้ชัด (Q6)
7. **Refine** = free-text → ตั้ง `pending={kind:"refine"}` → ป้อนเป็น feedback เข้า sub-loop →
   validate ใหม่ → brief ใหม่ (โครงเดียวกับ `answerPending`) (UX-Q3)
8. **Progress feedback** ระหว่าง sub-loop วน = status message เดียว **update-in-place**
   (`chat.update`) บอก phase + เลขรอบ ("กำลังร่าง (รอบ 2)…" → "กำลังตรวจสอบ…" → "ปรับตาม feedback…")
   เสริม typing dots ได้ — กัน "ค้างหรือเปล่า" ตอน no-cap (UX-Q1)
9. **ลบ idea cards / catalog / "Build this"** ทั้งหมด — แทนด้วย generate-workflow flow (Q8)

## ที่ mark ไว้คุยทีหลัง (ยังไม่ล็อก)
- **Q4 — verdict format + rubric ของ validate-workflow**: strict JSON `{verdict, reasons[]}`
  (parse ไม่ได้ = No) หรือ free-text; rubric = คำถาม loop-me เดียว + checklist เป็น guidance แค่ไหน
- **Q7 — no-path safety valve**: no cap ตอนนี้ แต่ควรมี escalate ไหม (วนเกิน N รอบ → ถาม user
  ว่าจะดู draft ล่าสุด / แก้ requirement) กันวนเผา token เป็นอนันต์
- UX ที่เหลือ (P4 help surface, P6 `/workflow-ideas status` + error ที่บอก phase ที่ fail)

## การตัดสินใจด้าน implementation (คงเดิม)
- **Stack**: Slack Bolt + TypeScript, Socket Mode (ไม่ต้องมี public URL)
- **LLM**: ผ่าน **OpenRouter** (OpenAI-compatible SDK) — tool-calling format = OpenAI
  (`tool_calls` / `tool` messages). เปลี่ยน model ที่ `.env` → `OPENROUTER_MODEL`
  (default `anthropic/claude-opus-4.8-fast`); slug เก่า `claude-3.5-sonnet` ใช้ไม่ได้แล้ว (404)
- **State store**: JSON ไฟล์ต่อ thread (`.state/`) — persist-and-resume, re-entrant, keyed by `thread_ts`
- **Disclosure-on-trigger**: เปิดเผยว่าอ่าน channel ก่อนเริ่ม

## โครงสร้างไฟล์ (จริงตอนนี้)
```
src/
  index.ts                         entrypoint (Bolt wiring)
  gateways/
    slack/slack.gateway.ts         โพสต์/อ่าน Slack (postParent, postQuestion, postIdeaCard, chat.update)
    slack/slack.handlers.ts        Bolt routing: /workflow-ideas + buttons + message replies
    llm/llm.gateway.ts             OpenRouter client + chat()
  services/
    context/context.service.ts     อ่าน + summarize channel → ContextSummary (+connectors)
    interview/interview.service.ts re-entrant loop (ask_user / propose) — จะปรับเป็น generate/validate
    interview/interview.prompts.ts tool schemas + system prompt
    interview/pain.ts              pain tracker
    interview/ask-validation.ts    validate ask_user
    interview/propose-validation.ts hard-gate ก่อนส่งต่อ generate
    interview/answer-quality.ts    impact signal
    ideas/ideas.service.ts         (legacy) idea validation — จะถูกแทน/ลบ
    build/build.service.ts         (legacy) "Build this" — จะถูกลบ
  repositories/
    state.repository.ts            persist/resume
    state.importer.ts
  shared/                          types.ts, config.ts, logger.ts, input.ts, thread-lock.ts
manifest.yaml                      Slack app manifest
workflows/morning-needs-me-digest.md   ตัวอย่างทรง spec เป้าหมาย
```

## งานหลักที่ยังเหลือ
- สร้าง `generate-workflow` + `validate-workflow` sub-loop (2 step, LLM คนละ call, uncapped gate แยก)
- เพิ่ม `pending` kinds: `review_workflow` (รอ Accept/Refine), `refine` (รอ free-text)
- Accept → เขียน `workflows/{slug}.md` + บอก path; ต่อ message handler ให้ route หลาย pending kinds
- เพิ่ม `connectors` ใน `ContextSummary` + prompt feasibility guidance
- brief แบบ Block Kit (UX-Q2) + progress update-in-place (UX-Q1)
- ลบ idea cards / catalog / build.service / ideas.service ออกจากเส้นหลัก
- ทดสอบ end-to-end ใน Slack จริง + `tsc` typecheck

## เรื่องที่ตั้งใจไม่ทำ (out of scope)
OAuth เข้า GitHub/Jira, autonomous monitoring (ไม่ต้อง trigger), RAG over full history,
multi-process scale-out, in-Slack `.md` editor (แก้ไฟล์นอกระบบแทน)
