// Lightweight Kemono proxy to dodge browser CORS limits.
// Usage:
//   1. `npm install` (if you already have a package.json) – no extra deps needed.
//   2. Run with `node proxy-server.js` (Node 18+ for global fetch support).
//   3. Keep your frontend API_BASE at `/api/proxy/kemono`.
//
// The proxy rewrites `/api/proxy/kemono/...` -> `https://kemono.cr/api/v1/...`
// and forwards the request server-side with the Accept header Kemono expects.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadEnvDefaults();

const PROXY_PORT = Number(process.env.PROXY_PORT || process.env.PORT || 3001);
const API_PROXY_PREFIX = "/api/proxy/kemono";
const KEMONO_API_HOST = process.env.KEMONO_HOST || "https://kemono.cr";
const KEMONO_API_BASE_PATH = process.env.KEMONO_BASE_PATH || "/api/v1";
const KEMONO_ACCEPT_HEADER = process.env.KEMONO_ACCEPT || "text/css";

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Empty request URL" }));
    return;
  }

  // Handle CORS preflight quickly.
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (!req.url.startsWith(API_PROXY_PREFIX)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not a Kemono proxy route" }));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "Allow": "GET, HEAD, OPTIONS",
    });
    res.end(JSON.stringify({ error: "Only GET/HEAD supported" }));
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathAfterPrefix = requestUrl.pathname.slice(API_PROXY_PREFIX.length);
  const basePath = trimTrailingSlash(KEMONO_API_BASE_PATH || "");

  let upstreamPathname;
  if (pathAfterPrefix.startsWith("/media/")) {
    upstreamPathname = pathAfterPrefix.replace("/media", "") || "/";
  } else {
    const normalized = pathAfterPrefix ? (pathAfterPrefix.startsWith("/") ? pathAfterPrefix : `/${pathAfterPrefix}`) : "";
    upstreamPathname = `${basePath}${normalized}` || "/";
  }

  const upstreamUrl = new URL(upstreamPathname + requestUrl.search, KEMONO_API_HOST);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        Accept: KEMONO_ACCEPT_HEADER,
        "User-Agent": "Kemono-Peruse-Proxy/1.0",
      },
    });

    const responseHeaders = {
      ...corsHeaders(),
      "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
      "Cache-Control": upstreamResponse.headers.get("cache-control") || "public, max-age=120",
    };

    res.writeHead(upstreamResponse.status, responseHeaders);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const bodyBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
    res.end(bodyBuffer);
  } catch (error) {
    console.error("Kemono proxy failed:", error);
    res.writeHead(502, {
      ...corsHeaders(),
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ error: "Failed to reach Kemono API" }));
  }
});

server.listen(PROXY_PORT, () => {
  console.log(
    `Kemono proxy listening on http://localhost:${PROXY_PORT}${API_PROXY_PREFIX} -> ${KEMONO_API_HOST}${KEMONO_API_BASE_PATH}`,
  );
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function trimTrailingSlash(value) {
  if (!value) return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function loadEnvDefaults() {
  const candidateFiles = [
    path.join(__dirname, ".env"),
    path.join(__dirname, ".env.local"),
    path.join(__dirname, "kemono-peruse", ".env"),
    path.join(__dirname, "kemono-peruse", ".env.local"),
  ];

  for (const file of candidateFiles) {
    applyEnvFromFile(file);
  }
}

function applyEnvFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) continue;

      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      process.env[key] = stripWrappingQuotes(rawValue);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Unable to load env file ${filePath}: ${error.message}`);
    }
  }
}

function stripWrappingQuotes(value) {
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
