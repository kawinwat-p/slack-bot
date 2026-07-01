// Generate service — coerce tool output, regenerate on Refine, orchestrate Slack delivery.

import type { WebClient } from "@slack/web-api";
import { chat } from "../../gateways/llm/llm.gateway.js";
import {
  clearThreadStatus,
  generateStatusMessages,
  postBrief,
  setThreadStatus,
  uploadWorkflowFile,
} from "../../gateways/slack/slack.gateway.js";
import { saveState } from "../../repositories/state.repository.js";
import { log, tid } from "../../shared/logger.js";
import type { ConvState, WorkflowSpec } from "../../shared/types.js";
import { coerceSpec, SpecValidationError } from "./coerce-spec.js";
import { parseRegenerateResponse, regenerateMessages } from "./workflow.prompts.js";

export interface GenerateDeps {
  client: WebClient;
  chatFn?: typeof chat;
}

export async function regenerate(
  deps: GenerateDeps,
  state: ConvState,
  feedback: string,
): Promise<WorkflowSpec> {
  const chatRound = deps.chatFn ?? chat;
  const messages = regenerateMessages(state, feedback);
  const msg = await chatRound(messages, undefined, true, 8000);
  const parsed = parseRegenerateResponse(msg.content ?? "{}");
  return coerceSpec(parsed, state.currentSpec?.id);
}

export async function runGenerate(
  deps: GenerateDeps,
  state: ConvState,
  args?: Record<string, unknown>,
  refineFeedback?: string,
): Promise<void> {
  const { client } = deps;
  const T = tid(state.threadTs);
  const { status, loadingMessages } = generateStatusMessages(!!refineFeedback);

  log("generate.start", { thread: T, refine: !!refineFeedback });
  state.phase = "generate";
  await setThreadStatus(client, state.channel, state.threadTs, status, loadingMessages);
  saveState(state);

  let spec: WorkflowSpec;
  try {
    if (refineFeedback) {
      if (!state.currentSpec) throw new SpecValidationError("No current spec to refine");
      spec = await regenerate(deps, state, refineFeedback);
    } else {
      spec = coerceSpec(args ?? {});
    }
  } catch (err) {
    await clearThreadStatus(client, state.channel, state.threadTs);
    saveState(state);
    throw err;
  }

  state.currentSpec = spec;
  saveState(state);

  await postBrief(client, state.channel, state.threadTs, spec);
  await uploadWorkflowFile(client, state.channel, state.threadTs, spec);
  await clearThreadStatus(client, state.channel, state.threadTs);

  state.phase = "review";
  state.pending = { kind: "review_workflow", specId: spec.id };
  saveState(state);
  log("generate.done", { thread: T, spec: spec.title, slug: spec.slug });
}
