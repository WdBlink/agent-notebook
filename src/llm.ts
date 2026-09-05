import { requestUrl } from "obsidian";
import { ERROR_MESSAGES } from "./constants";
import { buildUserPrompt, extractModelContent, parseDecompositionContent } from "./llm-core";
import type { CockpitError, CockpitResult, CockpitSettings, ModelDecomposition } from "./types";

export { buildUserPrompt, parseDecompositionContent } from "./llm-core";

export async function requestTaskDecomposition(settings: CockpitSettings, intent: string): Promise<CockpitResult<ModelDecomposition>> {
  const text = intent.trim();
  if (!text) {
    return failure("EMPTY_INTENT", ERROR_MESSAGES.emptyIntent);
  }

  try {
    const response = await requestUrl({
      url: settings.llmEndpoint,
      method: "POST",
      headers: buildHeaders(settings),
      body: JSON.stringify({
        model: settings.llmModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是一个每日待办拆解器。只返回 JSON，不要解释。JSON 形状必须是 {\"tasks\":[{\"title\":\"\",\"detail\":\"\",\"category\":\"research|build|write|analysis|admin|other\",\"priority\":\"P0|P1|P2\"}]}"
          },
          {
            role: "user",
            content: buildUserPrompt(text)
          }
        ]
      })
    });

    if (response.status < 200 || response.status >= 300) {
      return failure("LLM_FAILED", `${ERROR_MESSAGES.llmFailed} HTTP ${response.status}`);
    }

    const content = extractModelContent(response.json);
    return parseDecompositionContent(content, settings.llmModel);
  } catch (error) {
    console.error("[agent-notebook] model decomposition failed", error);
    return failure("LLM_FAILED", ERROR_MESSAGES.llmFailed);
  }
}

function buildHeaders(settings: CockpitSettings): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (settings.llmApiKey) {
    headers.Authorization = `Bearer ${settings.llmApiKey}`;
  }
  return headers;
}

function failure(code: CockpitError["code"], message: string): CockpitResult<never> {
  return { ok: false, error: { code, message } };
}
