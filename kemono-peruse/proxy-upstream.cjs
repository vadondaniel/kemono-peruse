const DEFAULT_TIMEOUT_MS = 6000;

function isArchiveHost(hostname, host, source) {
  const domains = [new URL(host).hostname];
  if (source === "kemono" && domains[0] === "kemono.cr") domains.push("kemono.su");
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function normalizeTags(tags) {
  if (Array.isArray(tags) || typeof tags !== "string") return tags;
  const text = tags.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* Pawchive also returns PostgreSQL array literals. */ }
  return (text.startsWith("{") && text.endsWith("}") ? text.slice(1, -1) : text)
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((tag) => tag.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"'))
    .filter(Boolean);
}

function normalizePayload(payload, source, host, prefix) {
  if (Array.isArray(payload)) return payload.map((entry) => normalizePayload(entry, source, host, prefix));
  if (!payload || typeof payload !== "object") return payload;
  const result = { ...payload };
  if ("tags" in result) result.tags = normalizeTags(result.tags);
  const normalizeFile = (file) => {
    if (!file?.path) return file;
    const path = file.path.startsWith("/") ? file.path : `/${file.path}`;
    const dataPath = path.startsWith("/data/") ? path : `/data${path}`;
    const server = new URL(file.server || host);
    // Only encode upstream-owned servers; never turn the proxy into an open relay.
    if (!isArchiveHost(server.hostname, host, source)) return file;
    return {
      ...file,
      original: file.original || new URL(dataPath, server).href,
      url: file.url || new URL(dataPath, server).href,
      path: `/__${source}/${encodeURIComponent(server.hostname)}${dataPath}`,
    };
  };
  if (result.file) result.file = normalizeFile(result.file);
  if (Array.isArray(result.attachments)) result.attachments = result.attachments.map(normalizeFile);
  if (result.post) result.post = normalizePayload(result.post, source, host, prefix);
  if (typeof result.content === "string") {
    const files = [payload.file, ...(payload.attachments || [])].filter((file) => file?.path);
    result.content = result.content.replace(/src=(["'])(\/(?!\/)[^"']*)\1/gi, (match, quote, path) => {
      const file = files.find((item) => path === item.path || path === `/data${item.path}`);
      const mediaPath = file ? normalizeFile(file).path
        : `/__${source}/${encodeURIComponent(new URL(host).hostname)}${path}`;
      return `src=${quote}${prefix}/media${mediaPath}${quote}`;
    });
  }
  return result;
}

async function fetchArchive(url, options = {}, config = {}) {
  const fetchImpl = config.fetch || fetch;
  const pawHost = config.pawHost || process.env.PAWCHIVE_HOST || "https://pawchive.pw";
  const kemonoHost = config.kemonoHost || process.env.KEMONO_HOST || "https://kemono.cr";
  const prefix = config.prefix || "/api/proxy/kemono";
  const input = new URL(url);
  const isMedia = !input.pathname.startsWith(process.env.KEMONO_BASE_PATH || "/api/v1");
  let path = input.pathname;
  const marker = path.match(/^\/__(pawchive|kemono)\/([^/]+)(\/.*)$/);
  let sources = ["pawchive", "kemono"];
  if (marker) {
    sources = [marker[1]];
    path = marker[3];
  }
  let lastError;
  for (const source of sources) {
    const host = source === "pawchive" ? pawHost : kemonoHost;
    const target = new URL(path + input.search, host);
    if (marker) {
      const hostname = decodeURIComponent(marker[2]);
      if (!isArchiveHost(hostname, host, source)) throw new Error("Invalid media host");
      target.hostname = hostname;
    } else if (isMedia && path.startsWith("/icons/") && source === "kemono") {
      target.hostname = `img.${new URL(host).hostname}`;
    } else if (isMedia && !path.startsWith("/icons/") && !path.startsWith("/data/")) {
      target.pathname = `/data${path}`;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs || DEFAULT_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      const response = await fetchImpl(target, { ...options, signal });
      if (!response.ok && response.status !== 304) {
        await response.body?.cancel();
        throw new Error(`${source} returned ${response.status}`);
      }
      if (isMedia || options.method === "HEAD" || response.status === 304) return response;
      const data = await response.json();
      const list = /\/(creators|posts)\/?$/.test(path);
      if (list ? !Array.isArray(data) : !data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`${source} returned an invalid payload`);
      }
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.set("content-type", "application/json");
      headers.set("x-archive-source", source);
      return new Response(JSON.stringify(normalizePayload(data, source, host, prefix)), { status: response.status, headers });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
    } finally {
      // Media streams may take much longer than the time allowed to receive headers.
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

module.exports = { fetchArchive, normalizePayload, normalizeTags };
