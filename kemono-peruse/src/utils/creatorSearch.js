export const DEFAULT_CREATOR_SEARCH_LIMIT = 30;

export function runCreatorDirectorySearch({ directory, serviceFilter, tokens, limit }) {
  if (!Array.isArray(directory) || !Array.isArray(tokens) || tokens.length === 0) {
    return { results: [], total: 0 };
  }

  const normalizedService = typeof serviceFilter === "string" ? serviceFilter : "all";
  const normalizedTokens = tokens
    .map((token) => String(token || "").trim().toLowerCase())
    .filter(Boolean);

  if (normalizedTokens.length === 0) {
    return { results: [], total: 0 };
  }

  const matches = [];
  for (const entry of directory) {
    if (!entry) continue;
    if (normalizedService !== "all" && entry.service !== normalizedService) {
      continue;
    }
    const nameLower = typeof entry.nameLower === "string" ? entry.nameLower : "";
    const idLower = typeof entry.idLower === "string" ? entry.idLower : "";
    const isMatch = normalizedTokens.every((token) => nameLower.includes(token) || idLower.includes(token));
    if (isMatch) {
      matches.push(entry);
    }
  }

  matches.sort((a, b) => {
    if (b.favorited !== a.favorited) return b.favorited - a.favorited;
    if (b.updated !== a.updated) return b.updated - a.updated;
    if (b.indexed !== a.indexed) return b.indexed - a.indexed;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });

  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_CREATOR_SEARCH_LIMIT;

  return {
    results: matches.slice(0, normalizedLimit),
    total: matches.length,
  };
}
