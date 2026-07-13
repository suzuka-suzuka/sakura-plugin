export function normalizeMessageIdentifier(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (typeof value !== "string") {
    return "";
  }

  const identifier = value.trim();
  if (
    !identifier
    || /^function\b/.test(identifier)
    || identifier.includes("[native code]")
  ) {
    return "";
  }

  return identifier;
}

export function getMessageIdentifier(...values) {
  for (const value of values) {
    const identifier = normalizeMessageIdentifier(value);
    if (identifier) return identifier;
  }
  return "";
}
