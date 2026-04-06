const DEFAULT_LIMIT = 30;

let creatorDirectory = [];

const runCreatorDirectorySearch = ({ directory, serviceFilter, tokens, limit }) => {
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

  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
  return {
    results: matches.slice(0, normalizedLimit),
    total: matches.length,
  };
};

self.onmessage = (event) => {
  const payload = event?.data;
  if (!payload || typeof payload !== "object") return;

  if (payload.type === "setDirectory") {
    creatorDirectory = Array.isArray(payload.directory) ? payload.directory : [];
    return;
  }

  if (payload.type === "search") {
    const requestId = Number(payload.requestId);
    const resolvedRequestId = Number.isFinite(requestId) ? requestId : 0;
    const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    const serviceFilter = typeof payload.serviceFilter === "string" ? payload.serviceFilter : "all";
    const limit = Number(payload.limit);

    const result = runCreatorDirectorySearch({
      directory: creatorDirectory,
      serviceFilter,
      tokens,
      limit,
    });

    self.postMessage({
      type: "searchResult",
      requestId: resolvedRequestId,
      results: result.results,
      total: result.total,
    });
  }
};
