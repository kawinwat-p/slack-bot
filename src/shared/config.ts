const REQUIRED = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET", "OPENROUTER_API_KEY"] as const;

export interface AppConfig {
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  openrouterSiteUrl: string;
  stateDbPath: string;
  llmTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error("Missing required environment variables:\n  " + missing.join("\n  "));
    process.exit(1);
  }
  return {
    slackBotToken: process.env.SLACK_BOT_TOKEN!,
    slackAppToken: process.env.SLACK_APP_TOKEN!,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET!,
    openrouterApiKey: process.env.OPENROUTER_API_KEY!,
    openrouterModel: process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-4.8-fast",
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    openrouterSiteUrl: process.env.OPENROUTER_SITE_URL ?? "https://example.com",
    stateDbPath: process.env.STATE_DB_PATH ?? ".state/state.db",
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? "30000"),
  };
}
