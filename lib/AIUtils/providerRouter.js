import Setting from "../setting.js";

const scheduleCursors = new Map();
export const CREDENTIAL_SCHEDULING_STRATEGY = "priority_weighted";

export function isRequestConfigComplete(config, expectedProtocol) {
  if (!config || config.channelType !== expectedProtocol || !config.model) {
    return false;
  }

  if (expectedProtocol === "gemini" && config.vertex === true) {
    return Boolean(config.serviceAccountRef);
  }

  return Boolean(config.apiKey);
}

export function prioritizeRouteAttempt(plan, preferredAttempt) {
  if (!plan || !Array.isArray(plan.attempts) || !preferredAttempt) {
    return plan;
  }

  const remainingAttempts = plan.attempts.filter((attempt) => attempt !== preferredAttempt);
  return {
    ...plan,
    attempts: [preferredAttempt, ...remainingAttempts],
  };
}

function redactRouterError(error, credential) {
  let message = error?.message || String(error || "未知错误");
  const secrets = [credential?.apiKey].filter(
    (value) => typeof value === "string" && value.length > 0
  );

  for (const secret of secrets) {
    message = message.split(secret).join("[REDACTED]");
  }

  return message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function routerLogValue(value) {
  return JSON.stringify(String(value ?? ""));
}

export function formatRouteAttemptFailure({
  routeId,
  attempt,
  error,
  attemptNumber,
  totalAttempts,
  nextAttempt = null,
  retryDelayMs = 0,
}) {
  const retryable = error?.retryable === true;
  const action = !retryable ? "停止回退" : nextAttempt ? "回退" : "尝试耗尽";
  const status = error?.status == null ? "unknown" : String(error.status);
  const fields = [
    "[AI Router] 调用失败",
    `route=${routerLogValue(routeId)}`,
    `attempt=${attemptNumber}/${totalAttempts}`,
    `target=${routerLogValue(attempt?.target?.id)}`,
    `provider=${routerLogValue(attempt?.provider?.id)}`,
    `credential=${routerLogValue(attempt?.credential?.id)}`,
    `model=${routerLogValue(attempt?.requestConfig?.model)}`,
    `status=${status}`,
    `retryable=${retryable}`,
    `action=${action}`,
  ];

  if (nextAttempt) {
    fields.push(
      `nextTarget=${routerLogValue(nextAttempt.target?.id)}`,
      `nextProvider=${routerLogValue(nextAttempt.provider?.id)}`,
      `nextCredential=${routerLogValue(nextAttempt.credential?.id)}`,
      `nextModel=${routerLogValue(nextAttempt.requestConfig?.model)}`,
      `delayMs=${Math.max(0, Number(retryDelayMs) || 0)}`
    );
  }

  fields.push(`error=${routerLogValue(redactRouterError(error, attempt?.credential))}`);
  return fields.join(" ");
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function priorityOf(item) {
  const priority = Number(item?.priority);
  return Number.isFinite(priority) ? priority : 0;
}

function rotate(items, cursorKey) {
  if (items.length < 2) return [...items];
  const cursor = scheduleCursors.get(cursorKey) || 0;
  const start = cursor % items.length;
  scheduleCursors.set(cursorKey, (start + 1) % items.length);
  return [...items.slice(start), ...items.slice(0, start)];
}

function weightedOrder(items, cursorKey) {
  if (items.length < 2) return [...items];
  const wheel = items.flatMap((item) =>
    Array.from({ length: Math.min(positiveInteger(item.weight), 100) }, () => item)
  );
  const seen = new Set();
  const ordered = [];

  for (const item of rotate(wheel, cursorKey)) {
    if (seen.has(item)) continue;
    seen.add(item);
    ordered.push(item);
  }
  return ordered;
}

export function orderScheduledItems(items, strategy, cursorKey) {
  const enabled = items.filter((item) => item?.enabled !== false);
  if (enabled.length < 2) return enabled;
  if (strategy === "round_robin") return rotate(enabled, cursorKey);
  if (strategy === "weighted_round_robin") return weightedOrder(enabled, cursorKey);

  const groups = new Map();
  for (const item of enabled) {
    const priority = priorityOf(item);
    if (!groups.has(priority)) groups.set(priority, []);
    groups.get(priority).push(item);
  }

  return [...groups.keys()]
    .sort((a, b) => b - a)
    .flatMap((priority) => {
      const group = groups.get(priority);
      return strategy === "priority_weighted"
        ? weightedOrder(group, `${cursorKey}:priority:${priority}`)
        : group;
    });
}

function configuredNumber(override, fallback) {
  if (Number.isFinite(override) && override >= 0) return override;
  if (Number.isFinite(fallback) && fallback >= 0) return fallback;
  return undefined;
}

export function resolveGenerationSettings(route, target) {
  const commonLevel = route.reasoningLevel || "default";

  let openaiReasoningEffort = target.openaiReasoningEffort || "inherit";
  if (openaiReasoningEffort === "inherit") {
    openaiReasoningEffort = commonLevel === "off" ? "none" : commonLevel;
  }
  if (openaiReasoningEffort === "default") {
    openaiReasoningEffort = undefined;
  }

  let geminiThinkingLevel;
  let geminiThinkingBudget;
  const explicitBudget = Number(target.geminiThinkingBudget);
  if (Number.isInteger(explicitBudget) && explicitBudget >= -1) {
    geminiThinkingBudget = explicitBudget;
  } else {
    const targetLevel = target.geminiThinkingLevel || "inherit";
    const resolvedLevel = targetLevel === "inherit" ? commonLevel : targetLevel;
    if (resolvedLevel === "off") {
      geminiThinkingBudget = 0;
    } else if (resolvedLevel !== "default") {
      geminiThinkingLevel = resolvedLevel;
    }
  }

  return {
    temperature: configuredNumber(target.temperatureOverride, route.temperature),
    topP: configuredNumber(target.topPOverride, route.topP),
    openaiEnableThinking: target.openaiEnableThinking === true,
    openaiReasoningEffort,
    geminiThinkingLevel,
    geminiThinkingBudget,
  };
}

export function modelSupportsDirectImageInput(model) {
  const normalized = String(model || "").trim().toLowerCase();
  return Boolean(normalized) && !normalized.includes("deepseek");
}

function buildRequestConfig(route, target, provider, credential) {
  return {
    name: `${route.id}/${target.id}`,
    channelType: provider.protocol,
    baseURL: provider.baseURL,
    vertex: provider.vertex === true,
    apiKey: credential.apiKey,
    serviceAccountRef: credential.serviceAccountRef,
    model: target.model,
    ...resolveGenerationSettings(route, target),
    nativeWebSearch: target.nativeWebSearch === true,
    providerId: provider.id,
    credentialId: credential.id,
    targetId: target.id,
  };
}

export function createRouteExecutionPlan(routeId, options = {}) {
  const scope = options.selfId == null ? {} : { selfId: options.selfId };
  const scopeKey = options.selfId == null ? "default" : String(options.selfId);
  const providers = Setting.getConfig("Providers", scope)?.providers || [];
  const routes = Setting.getConfig("Routes", scope)?.routes || [];
  const route = routes.find((item) => item.id === routeId);
  if (!route) throw new Error(`未找到 AI 路由：${routeId}`);

  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const targets = orderScheduledItems(
    route.targets || [],
    route.strategy,
    `scope:${scopeKey}:route:${route.id}`
  );
  const resolvedTargets = [];

  for (const target of targets) {
    const provider = providerMap.get(target.provider);
    if (!provider) {
      logger.warn(`[AI Router] 路由 ${route.id} 的目标 ${target.id} 引用了不存在的供应商 ${target.provider}`);
      continue;
    }
    const credentials = orderScheduledItems(
      provider.credentials || [],
      CREDENTIAL_SCHEDULING_STRATEGY,
      `scope:${scopeKey}:provider:${provider.id}`
    );
    resolvedTargets.push({ target, provider, credentials });
  }

  const makeAttempt = ({ target, provider }, credential) => ({
    route,
    target,
    provider,
    credential,
    requestConfig: buildRequestConfig(route, target, provider, credential),
  });
  const interleave = (entries) => {
    const result = [];
    const maxCredentials = Math.max(0, ...entries.map((entry) => entry.credentials.length));
    for (let index = 0; index < maxCredentials; index++) {
      for (const entry of entries) {
        const credential = entry.credentials[index];
        if (credential) result.push(makeAttempt(entry, credential));
      }
    }
    return result;
  };

  let attempts = [];
  if (route.strategy === "round_robin" || route.strategy === "weighted_round_robin") {
    attempts = interleave(resolvedTargets);
  } else {
    const priorityGroups = new Map();
    for (const entry of resolvedTargets) {
      const priority = priorityOf(entry.target);
      if (!priorityGroups.has(priority)) priorityGroups.set(priority, []);
      priorityGroups.get(priority).push(entry);
    }
    for (const priority of [...priorityGroups.keys()].sort((a, b) => b - a)) {
      const entries = priorityGroups.get(priority);
      if (route.strategy === "priority_weighted") {
        attempts.push(...interleave(entries));
      } else {
        for (const entry of entries) {
          attempts.push(...entry.credentials.map((credential) => makeAttempt(entry, credential)));
        }
      }
    }
  }

  const maxAttempts = positiveInteger(route.maxAttempts, attempts.length || 1);
  return { route, attempts: attempts.slice(0, maxAttempts) };
}

export function resolveRouteTarget(routeId, options = {}) {
  return createRouteExecutionPlan(routeId, options).attempts[0] || null;
}
