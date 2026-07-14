import fs from "node:fs/promises";
import path from "node:path";
import { plugindata } from "./path.js";

const REACTION_EMOJI_FILE = path.join(plugindata, "reactionEmojiIds.json");
const EXCLUDED_REACTION_EMOJI_IDS = new Set(["124", "128076"]);

let emojiIds = [];
let loadPromise = null;
let persistQueue = Promise.resolve();

function warn(message) {
  globalThis.logger?.warn?.(`[ReactionEmojiStore] ${message}`);
}

export function normalizeReactionEmojiId(value) {
  const emojiId = String(value ?? "").trim();
  if (!/^\d+$/.test(emojiId)) return null;
  return EXCLUDED_REACTION_EMOJI_IDS.has(emojiId) ? null : emojiId;
}

function normalizeReactionEmojiIds(values) {
  const normalized = (Array.isArray(values) ? values : [])
    .map(normalizeReactionEmojiId)
    .filter(Boolean);
  return [...new Set(normalized)];
}

async function loadReactionEmojiIds() {
  try {
    const raw = await fs.readFile(REACTION_EMOJI_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const storedIds = Array.isArray(parsed) ? parsed : parsed?.emojiIds;
    emojiIds = normalizeReactionEmojiIds(storedIds);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      warn(`读取已收集的表情 ID 失败，将使用空列表: ${error.message}`);
    }
    emojiIds = [];
  }

  return emojiIds;
}

async function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = loadReactionEmojiIds();
  }
  await loadPromise;
}

async function persistReactionEmojiIds(snapshot) {
  await fs.mkdir(path.dirname(REACTION_EMOJI_FILE), { recursive: true });
  await fs.writeFile(
    REACTION_EMOJI_FILE,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8"
  );
}

export function extractReactionEmojiIds(event) {
  if (!event || event.is_add === false) return [];

  const candidates = [];
  if (Array.isArray(event.likes)) {
    for (const like of event.likes) {
      if (like?.is_add === false) continue;
      candidates.push(like?.emoji_id ?? like?.face_id);
    }
  }

  candidates.push(event.emoji_id ?? event.face_id);
  return normalizeReactionEmojiIds(candidates);
}

export function isReactionFromOtherUser(event) {
  const userId = event?.user_id ?? event?.operator_id;
  if (userId == null || event?.self_id == null) return false;
  return String(userId) !== String(event.self_id);
}

export async function getReactionEmojiIds() {
  await ensureLoaded();
  return [...emojiIds];
}

export async function recordReactionEmojiIds(values) {
  await ensureLoaded();

  const knownIds = new Set(emojiIds);
  const addedIds = normalizeReactionEmojiIds(values).filter(
    (emojiId) => !knownIds.has(emojiId)
  );
  if (addedIds.length === 0) return [];

  emojiIds = [...emojiIds, ...addedIds];
  const snapshot = [...emojiIds];

  persistQueue = persistQueue
    .catch((error) => {
      warn(`上一次保存表情 ID 失败: ${error.message}`);
    })
    .then(() => persistReactionEmojiIds(snapshot));
  await persistQueue;

  return addedIds;
}

export function chooseRandomReactionEmojiId(values, random = Math.random) {
  const availableIds = normalizeReactionEmojiIds(values);
  if (availableIds.length === 0) return null;

  const index = Math.min(
    Math.floor(random() * availableIds.length),
    availableIds.length - 1
  );
  return availableIds[index];
}
