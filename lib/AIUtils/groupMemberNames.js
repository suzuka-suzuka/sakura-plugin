function normalizeIdentifier(value) {
  return value == null ? "" : String(value);
}

function normalizeDisplayName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toMemberList(members) {
  if (Array.isArray(members)) return members;
  if (members instanceof Map) return [...members.values()];
  return [];
}

function setMemberName(memberNames, userId, displayName) {
  const normalizedUserId = normalizeIdentifier(userId);
  const normalizedName = normalizeDisplayName(displayName);
  if (!normalizedUserId || !normalizedName) return;
  memberNames.set(normalizedUserId, normalizedName);
}

export function buildGroupMemberNameMap(records = [], groupMembers = []) {
  const memberNames = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    setMemberName(memberNames, record?.userId, record?.senderName);
    setMemberName(
      memberNames,
      record?.repliedMessage?.userId,
      record?.repliedMessage?.senderName
    );
  }

  for (const member of toMemberList(groupMembers)) {
    const userId = member?.user_id ?? member?.userId;
    setMemberName(
      memberNames,
      userId,
      member?.card || member?.nickname || userId
    );
  }

  return memberNames;
}

export function buildGroupMessageRecordMap(records = []) {
  const messageRecords = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    for (const identifier of [
      record?.messageId,
      record?.messageSeq,
      record?.realSeq,
    ]) {
      const normalized = normalizeIdentifier(identifier);
      if (normalized) messageRecords.set(normalized, record);
    }
  }
  return messageRecords;
}

export async function resolveGroupMemberNameMap(event, records = []) {
  const fallback = buildGroupMemberNameMap(records);
  const group = event?.group || event?.bot?.pickGroup?.(event?.group_id);
  if (!group?.getMemberList) return fallback;

  const members = await group.getMemberList(false);
  return buildGroupMemberNameMap(records, members);
}

export function applyGroupMemberNames(records = [], memberNames = new Map()) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const senderName = memberNames.get(normalizeIdentifier(record?.userId));
    const repliedMessage = record?.repliedMessage;
    const repliedSenderName = memberNames.get(
      normalizeIdentifier(repliedMessage?.userId)
    );

    return {
      ...record,
      senderName: senderName || record?.senderName,
      repliedMessage: repliedMessage
        ? {
            ...repliedMessage,
            senderName: repliedSenderName || repliedMessage.senderName,
          }
        : repliedMessage,
    };
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMappedName(memberNames, userId, fallback = "") {
  const normalizedUserId = normalizeIdentifier(userId);
  const mappedName = normalizeDisplayName(memberNames?.get(normalizedUserId));
  if (mappedName && mappedName !== normalizedUserId) return mappedName;

  const fallbackName = normalizeDisplayName(fallback);
  return fallbackName && fallbackName !== normalizedUserId ? fallbackName : "";
}

export function replaceGroupMemberReferences(
  content,
  record,
  { memberNames = new Map(), messageRecords = new Map() } = {}
) {
  let result = String(content ?? "");

  for (const target of Array.isArray(record?.atTargets) ? record.atTargets : []) {
    const targetId = normalizeIdentifier(target);
    const targetName = getMappedName(memberNames, targetId);
    if (!targetId || !targetName) continue;

    const atPattern = new RegExp(`@${escapeRegExp(targetId)}(?!\\d)`, "g");
    result = result.replace(atPattern, () => `@${targetName}`);
  }

  const replyId = normalizeIdentifier(record?.replyToMessageId);
  if (!replyId) return result;

  const repliedMessage = record?.repliedMessage || messageRecords.get(replyId);
  const replyName = getMappedName(
    memberNames,
    repliedMessage?.userId,
    repliedMessage?.senderName
  );
  if (!replyName) return result;

  const replyPattern = new RegExp(`\\[回复:${escapeRegExp(replyId)}\\]`, "g");
  return result.replace(replyPattern, () => `[回复:${replyName}]`);
}
