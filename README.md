# Workflow Ideas Bot

An **agentic** Slack bot: you trigger it manually, it reads the channel, deep-interviews
you with sharp context-grounded questions, then proposes **buildable** workflow ideas and
acts on the ones you pick — all inside Slack. Built per `workflow-ideas-bot-spec.md`.

## How it maps to the design

| Spec decision | Where it lives |
| --- | --- |
| Manual trigger | `/workflow-ideas` in `app.ts` |
| Retrieve + summarize context, disclosed | `context.ts`, disclosure message in `app.ts` |
| Hybrid LLM tool-calling loop | `agent.ts` + `prompts.ts` (tools: `ask_user`, `propose_ideas`) |
| LLM via OpenRouter (OpenAI-compatible) | `llm.ts` — swap models with `OPENROUTER_MODEL` |
| Persist-and-resume (re-entrant) | `state.ts`; loop suspends on `ask_user`, resumes on reply |
| Confidence + ceiling (max 4) + Skip | `MAX_QUESTIONS`, ceiling check in `agent.ts`, Skip button |
| Constrained catalog ∩ evidence | `catalog.ts` (`allowedBlocksFor`) |
| Deterministic validation (not "ask the LLM") | `ideas.ts` (`validateIdeas`) |
| Idea cards + Build / Refine / Not it | `slackui.ts` |
| Build this — mixed per-block | `build.ts` (execute in Slack vs hand back artifact) |
| Tiered approval for blast-radius builds | `isBlastRadius` + Confirm card in `app.ts` |

## Run it

1. **Create the Slack app** at <https://api.slack.com/apps> → *From an app manifest* → paste
   `manifest.yaml`. Enable **Socket Mode** and generate an App-Level Token with
   `connections:write`. Install to your workspace.
2. `cp .env.example .env` and fill in the three Slack tokens + your `OPENROUTER_API_KEY`
   (get one at <https://openrouter.ai/keys>). Pick any model via `OPENROUTER_MODEL`.
3. `npm install`
4. `npm run dev`
5. In any channel the bot is in: `/workflow-ideas`.

## Flow at runtime

```
/workflow-ideas
  → bot posts a disclosure line, reads ~200 msgs, summarizes patterns
  → opens a thread with ONE grounded question (buttons + "Skip")
  → adapts for up to 4 questions, stops the moment it's confident
  → posts 2–4 idea cards, each citing the evidence that motivated it
  → "Build this": canvas/reminder execute live (scheduled post asks to Confirm first);
     CI/GitHub/cron ideas hand back ready-to-paste snippets
```

## Notes / scope

- State is a JSON file per thread (`.state/`). Swap for SQLite/Redis in production — callers
  don't change.
- Out of scope by design: OAuth into GitHub/Jira, autonomous monitoring, RAG over full
  history. See spec §10.
- The agent calls one tool per turn; multi-tool turns are defensively no-op'd to keep the
  Anthropic tool-result contract valid.
