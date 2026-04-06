import { runCreatorDirectorySearch } from "../utils/creatorSearch.js";

let creatorDirectory = [];

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
