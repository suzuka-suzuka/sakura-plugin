import { randomUUID } from "node:crypto";

function createToolCallId() {
  return `call_${randomUUID().replaceAll("-", "")}`;
}

function normalizedId(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function ensureToolCallIds(response, idFactory = createToolCallId) {
  if (!response || !Array.isArray(response.functionCalls) || response.functionCalls.length === 0) {
    return response;
  }

  const rawParts = Array.isArray(response.rawParts) ? response.rawParts : [];
  const rawFunctionCalls = rawParts
    .filter((part) => part?.functionCall)
    .map((part) => part.functionCall);
  const ids = response.functionCalls.map((functionCall, index) =>
    normalizedId(functionCall?.id) ||
    normalizedId(rawFunctionCalls[index]?.id) ||
    normalizedId(idFactory())
  );
  const functionCalls = response.functionCalls.map((functionCall, index) => ({
    ...functionCall,
    id: ids[index],
  }));

  return {
    ...response,
    functionCalls,
    // Gemini thought signatures are bound to their original Part. Keep rawParts
    // byte-for-byte equivalent instead of injecting our internal call IDs.
    rawParts,
  };
}

export const GEMINI_EXTERNAL_TOOL_SIGNATURE = "skip_thought_signature_validator";

export function prepareHistoryForGemini(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && Array.isArray(item.parts))
    .map((item) => ({
      role: item.role,
      parts: item.parts.map((part) => {
        const needsExternalSignature =
          item.role === "model" &&
          item.sourceProtocol === "openai" &&
          part?.functionCall &&
          !part.thoughtSignature;

        return needsExternalSignature
          ? { ...part, thoughtSignature: GEMINI_EXTERNAL_TOOL_SIGNATURE }
          : part;
      }),
    }));
}
