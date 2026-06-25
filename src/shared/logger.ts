// Logger กลาง — timestamp + step + รายละเอียด. ปิดด้วย env LOG=off

const ON = process.env.LOG !== "off";

export function log(step: string, detail?: unknown): void {
  if (!ON) return;
  const t = new Date().toISOString().slice(11, 19); // HH:MM:SS
  let d = "";
  if (detail !== undefined) {
    d = typeof detail === "string" ? detail : JSON.stringify(detail);
    d = " — " + d;
  }
  console.log(`[${t}] ${step}${d}`);
}

/** ย่อ thread_ts ให้สั้นไว้ correlate log ของบทสนทนาเดียวกัน */
export function tid(threadTs: string): string {
  return threadTs.slice(-6);
}
