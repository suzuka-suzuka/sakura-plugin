import Setting from "../setting.js";
import { getAI, getCurrentAndPreviousUserText } from "./getAI.js";
import { executeToolCalls } from "./tools/tools.js";
import {
  checkAndClearStopFlag,
  finishAiTask,
  startAiTask,
} from "./stopFlag.js";

const DEFAULT_MAX_TOOL_CALLS = 20;

export function getAgentMaxToolCalls(e = null) {
  const aiConfig = Setting.getConfig("AI", { selfId: e?.self_id }) || {};
  const value = Number(aiConfig.maxToolCalls);
  return Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_MAX_TOOL_CALLS;
}

function buildModelResponseParts(response) {
  const textContent = response?.text || "";
  const functionCalls = response?.functionCalls || [];
  const rawParts = response?.rawParts || [];

  if (rawParts.length > 0) {
    return rawParts;
  }

  const parts = [];
  if (textContent) {
    parts.push({ text: textContent });
  }

  for (const functionCall of functionCalls) {
    parts.push({ functionCall });
  }

  return parts;
}

export async function runAgentLoop({
  label = "Agent",
  e,
  channel,
  queryParts,
  prompt,
  groupContext,
  toolGroup,
  history = [],
  lockedVectorContext = null,
  pluginInstance = null,
  maxToolCalls = getAgentMaxToolCalls(e),
  onIntermediateText = null,
  includeUserHistoryPart = (part) => !part.inlineData,
}) {
  const currentFullHistory = history;
  const vectorContext =
    lockedVectorContext ??
    getCurrentAndPreviousUserText(queryParts, currentFullHistory);
  const taskId = startAiTask(e);
  let toolCallCount = 0;
  let finalText = "";

  try {
    let currentResponse = await getAI(
      channel,
      e,
      queryParts,
      prompt,
      groupContext,
      toolGroup,
      currentFullHistory,
      vectorContext
    );

    if (typeof currentResponse === "string") {
      return {
        status: "model_error",
        error: currentResponse,
        history: currentFullHistory,
        finalText,
        toolCallCount,
      };
    }

    const historyParts = Array.isArray(queryParts)
      ? queryParts.filter(includeUserHistoryPart)
      : [];
    if (historyParts.length > 0) {
      currentFullHistory.push({ role: "user", parts: historyParts });
    }

    while (true) {
      if (checkAndClearStopFlag(taskId)) {
        logger.info(`[${label}] User ${e.user_id} requested stop`);
        return {
          status: "stopped",
          history: currentFullHistory,
          finalText,
          toolCallCount,
        };
      }

      const textContent = currentResponse.text || "";
      const functionCalls = currentResponse.functionCalls || [];
      const modelResponseParts = buildModelResponseParts(currentResponse);

      if (modelResponseParts.length > 0) {
        currentFullHistory.push({
          role: "model",
          parts: modelResponseParts,
        });
      }

      if (functionCalls.length > 0) {
        toolCallCount++;
        if (toolCallCount >= maxToolCalls) {
          logger.warn(
            `[${label}] Tool call limit reached (${maxToolCalls}), ending loop`
          );
          return {
            status: "tool_limit",
            history: currentFullHistory,
            finalText,
            toolCallCount,
            maxToolCalls,
          };
        }

        if (textContent && onIntermediateText) {
          await onIntermediateText(textContent.replace(/\n+$/, ""));
        }

        const executedResults = await executeToolCalls(
          e,
          functionCalls,
          pluginInstance
        );
        currentFullHistory.push(...executedResults);

        currentResponse = await getAI(
          channel,
          e,
          "",
          prompt,
          groupContext,
          toolGroup,
          currentFullHistory,
          vectorContext
        );

        if (typeof currentResponse === "string") {
          return {
            status: "model_error",
            error: currentResponse,
            history: currentFullHistory,
            finalText,
            toolCallCount,
          };
        }
        continue;
      }

      if (textContent) {
        finalText = textContent;
        return {
          status: "completed",
          history: currentFullHistory,
          finalText,
          toolCallCount,
        };
      }

      return {
        status: "empty",
        history: currentFullHistory,
        finalText,
        toolCallCount,
      };
    }
  } finally {
    finishAiTask(e, taskId);
  }
}
