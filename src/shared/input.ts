// Guardrail for user-typed free text before it enters any LLM prompt.
// Trust boundary: Slack users type arbitrary text (slash-command args + thread replies).
// Blocks (not truncates) two things: over-length, and sensitive content
// (credentials / PII / abusive language). Deterministic — no LLM call.
// ponytail: regex/keyword heuristics; false positives possible. Tune the patterns below.
// This is an internal-workspace tool; swap in a moderation API if exposed beyond the team.

export const MAX_INPUT = 1000;

export type InputCheck = { ok: true; text: string } | { ok: false; reason: string };

// Leaked secrets: an assignment-like "key: value" (not just mentioning the word) + known token shapes.
const SECRET = /(password|passwd|api[_-]?key|secret|token|bearer|private[_-]?key)\s*[:=]\s*\S+|-----BEGIN|\bsk-[A-Za-z0-9]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]+/i;

// PII: Thai national ID (13 digits), credit card (16 grouped), email, Thai phone.
const PII = /\b\d{13}\b|\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}\b/;

// Abuse: extend as needed (Thai + English).
const ABUSE_WORDS = ["fuck", "shit", "bitch", "asshole", "เหี้ย", "สัส", "ควย", "หี", "เย็ด", "มึงตาย"];
const ABUSE = new RegExp(ABUSE_WORDS.join("|"), "i");

export function checkInput(raw: unknown): InputCheck {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.length > MAX_INPUT) return { ok: false, reason: "ข้อความยาวเกิน 1000 ตัวอักษร ช่วยย่อให้สั้นลงหน่อย" };
  if (SECRET.test(s)) return { ok: false, reason: "ดูเหมือนมีข้อมูลลับ (รหัสผ่าน/คีย์/โทเคน) อยู่ — เอาออกก่อนนะ" };
  if (PII.test(s)) return { ok: false, reason: "ดูเหมือนมีข้อมูลส่วนบุคคล (เลขบัตร/เบอร์/อีเมล) อยู่ — เอาออกก่อนนะ" };
  if (ABUSE.test(s)) return { ok: false, reason: "ข้อความมีถ้อยคำไม่เหมาะสม ลองเรียบเรียงใหม่นะ" };
  return { ok: true, text: s }; // empty string is allowed (optional prompt); callers decide
}
