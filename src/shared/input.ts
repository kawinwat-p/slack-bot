// Guardrail for user-typed free text before it enters any LLM prompt.
// Trust boundary: Slack users type arbitrary text (slash-command args + thread replies)
// that gets embedded into prompts. Cap length + trim to bound cost/abuse and drop noise.
// ponytail: length cap only — not a prompt-injection firewall. This is an internal-
// workspace tool; inputs stay in user/tool roles as data. Add content moderation /
// injection screening if the bot is ever exposed beyond the team.

export const MAX_INPUT = 1000;

export function clampInput(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return s.trim().slice(0, MAX_INPUT);
}
