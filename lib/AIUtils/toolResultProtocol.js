const TOOL_FOLLOW_UP_RESULT = "sakura.tool-follow-up-result.v1";

export function createToolFollowUpResult(response, followUpParts = []) {
  return {
    kind: TOOL_FOLLOW_UP_RESULT,
    response,
    followUpParts,
  };
}

export function splitToolFollowUpResult(rawResult) {
  if (
    !rawResult ||
    rawResult.kind !== TOOL_FOLLOW_UP_RESULT ||
    !Array.isArray(rawResult.followUpParts)
  ) {
    return { response: rawResult, followUpParts: [] };
  }

  return {
    response: rawResult.response,
    followUpParts: rawResult.followUpParts.filter(
      (part) => part && typeof part === "object"
    ),
  };
}

export function buildToolCallbackPayload(executedResults = []) {
  const functionResponseParts = executedResults
    .map((result) => result?.functionResponsePart)
    .filter(Boolean);
  const queryParts = executedResults.flatMap(
    (result) => result?.followUpParts || []
  );
  const historyContents = [];

  if (functionResponseParts.length > 0) {
    historyContents.push({
      role: "function",
      parts: functionResponseParts,
    });
  }

  return { historyContents, queryParts };
}

function inlineDataKey(part) {
  const data = part?.inlineData?.data;
  return typeof data === "string" && data ? data : null;
}

export function collectUniqueInlineDataParts(...partCollections) {
  const seen = new Set();
  const uniqueParts = [];

  for (const parts of partCollections) {
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const key = inlineDataKey(part);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniqueParts.push(part);
    }
  }

  return uniqueParts;
}

export function filterNewInlineDataParts(parts = [], history = []) {
  if (!Array.isArray(parts)) return [];

  const historicalParts = Array.isArray(history)
    ? history.flatMap((item) => Array.isArray(item?.parts) ? item.parts : [])
    : [];
  const seen = new Set(
    collectUniqueInlineDataParts(historicalParts).map(inlineDataKey)
  );

  return parts.filter((part) => {
    const key = inlineDataKey(part);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function stripEphemeralUserParts(
  history = [],
  shouldKeepPart = (part) => !part?.inlineData
) {
  if (!Array.isArray(history)) return history;

  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    if (item?.role !== "user" || !Array.isArray(item.parts)) continue;

    const persistentParts = item.parts.filter(shouldKeepPart);
    if (persistentParts.length === 0) {
      history.splice(index, 1);
    } else if (persistentParts.length !== item.parts.length) {
      history[index] = { ...item, parts: persistentParts };
    }
  }

  return history;
}
