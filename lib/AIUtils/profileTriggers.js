export function getProfilePrefixes(profile) {
  if (!Array.isArray(profile?.prefixes)) return [];
  return profile.prefixes.filter(
    (prefix) => typeof prefix === "string" && prefix.length > 0
  );
}

export function getPrimaryPrefix(profile) {
  return getProfilePrefixes(profile)[0] || "";
}

export function findProfileByPrefix(profiles, prefix) {
  if (!Array.isArray(profiles) || typeof prefix !== "string") return null;
  return profiles.find((profile) => getProfilePrefixes(profile).includes(prefix)) || null;
}

export function matchProfilePrefix(profiles, text) {
  if (!Array.isArray(profiles) || typeof text !== "string") return null;

  const candidates = profiles.flatMap((profile, profileIndex) =>
    getProfilePrefixes(profile).map((prefix, prefixIndex) => ({
      profile,
      prefix,
      profileIndex,
      prefixIndex,
    }))
  );

  candidates.sort(
    (a, b) =>
      b.prefix.length - a.prefix.length ||
      a.profileIndex - b.profileIndex ||
      a.prefixIndex - b.prefixIndex
  );

  return candidates.find(({ prefix }) => text.startsWith(prefix)) || null;
}

