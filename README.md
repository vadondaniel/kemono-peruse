# Kemono Peruse

Single-page React UI for browsing Kemono posts plus a lightweight Node proxy to dodge browser CORS limits.

## Prerequisites

- Node.js 18+ (needed for the proxy's global `fetch`)
- npm (bundled with Node)

## Install Dependencies

```bash
cd kemono-peruse
npm install
```

## Run the Proxy

From the project root, start the proxy in its own terminal (create or edit `kemono-peruse/.env` first if you want different ports):

```bash
node proxy-server.js
```

Defaults:

- listens on `http://localhost:3001`
- rewrites `/api/proxy/kemono/…` → `https://kemono.cr/api/v1/…`
- forces `Accept: text/css` on upstream requests

Env overrides:

- `PROXY_PORT` (falls back to `PORT`) - proxy port (default `3001`)
- `KEMONO_HOST` - upstream host (default `https://kemono.cr`)
- `KEMONO_BASE_PATH` - upstream API prefix (default `/api/v1`)
- `KEMONO_ACCEPT` - custom `Accept` header (default `text/css`)

Media URLs such as `/data/…` are also tunneled automatically via `/api/proxy/kemono/media/…`.

## Run the Frontend

In a second terminal:

```bash
cd kemono-peruse
npm run dev
```

Vite serves at `http://localhost:5173` (set `VITE_DEV_SERVER_PORT` or `VITE_PORT` to change it) and proxies `/api/proxy/kemono` requests to the Node proxy, so keep both processes running. The dev proxy target automatically honors the `PROXY_PORT` value.

### Environment file

Copy `kemono-peruse/.env.example` to `kemono-peruse/.env` (or `.env.local`) and edit it to change both servers. The file stays untracked so your local ports remain yours:

```ini
PROXY_PORT=4000
VITE_DEV_SERVER_PORT=5175
```

Start the proxy (`node proxy-server.js`) and Vite (`npm run dev`) after saving the file so both processes pick up the new ports.

## Production Build

```bash
cd kemono-peruse
npm run build
```

The static bundle lands in `kemono-peruse/dist`. Deploy it with any static host and expose the proxy under `/api/proxy/kemono` on the same origin (or point `VITE_API_BASE` at your deployed proxy if you add that env var).
