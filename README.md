# Kemono Peruse

Kemono Peruse is a clean, keyboard-friendly reader for Kemono posts.

## Why you might like it

- **Fast navigation** – browse a creator’s archive with instant pagination, filters, and cached reads.
- **Comfortable reader** – adjustable typography, widths, and gallery-only view for image-heavy posts.
- **Attachment focus** – inline gallery with zoomable viewer, attachment lists, and direct original links.
- **Offline-friendly** – optional cached data stored per creator so repeated visits are instant.

## Quick start (end user)

1. **Install once**

   ```bash
   npm install --prefix kemono-peruse
   ```

2. **(Optional) set your ports** – copy `kemono-peruse/.env.example` to `kemono-peruse/.env` and edit the numbers you prefer:

   ```ini
   PROXY_PORT=4000
   VITE_DEV_SERVER_PORT=5175
   VITE_PREVIEW_PORT=5179
   ```

3. **Start the Kemono Peruse service** (the lightweight proxy) - from the repo root:

   ```bash
   cd kemono-peruse
   npm run proxy
   ```

4. **Run the UI** - in a second terminal:

   ```bash
   cd kemono-peruse
   npm run dev
   ```

5. Open `http://localhost:5173` (or whatever port you set) and browse creators. Leave both terminals running while you read.

### Handy launchers

- `npm run dev:all` - boots both the proxy (`npm run proxy`) and the Vite dev server in one terminal.
- `npm run host:all` - same as above but starts Vite with `--host` so phones/other devices on your LAN can connect.
- `npm run preview:all` - builds on `npm run preview` by also launching the proxy so you can test the production bundle locally.
- Windows shortcuts:
  - `run-dev.bat` (opens the dev URL from `.env` – default `http://localhost:5173` – then runs `npm run dev:all`)
  - `run-host.bat` (same idea, but calls `npm run host:all` for LAN testing)
  - `build.bat` (runs `npm run build` inside `kemono-peruse`)
  - `run-built.bat` (opens the preview URL defined in `.env` – default `http://localhost:4173` – then runs `npm run preview:all` so the proxy and preview server start together)

## How to use the app

- **Search or paste a creator URL** on the landing page to load their feed. Saved creators show up in the sidebar for quick recall.
- **Filter posts** using text or tag filters; filters sync with local storage so they persist across refreshes.
- **Switch posts** with the navigation controls inside the reader view - respecting active filters.
- **Inspect attachments** by expanding the attachment counter or switching to gallery view. Click any image to open the zoomable lightbox.
- **Adjust reading preferences** via the Reader Settings button. Choices (typeface, width, gallery behavior, etc.) persist per saved/un-saved state.

## Configuration options

These settings live in `kemono-peruse/.env` (or `.env.local` for Vite). Restart both processes after changing them.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PROXY_PORT` (or `PORT`) | Where the Kemono Peruse service listens | `3001` |
| `KEMONO_HOST` | Upstream Kemono host | `https://kemono.cr` |
| `KEMONO_BASE_PATH` | Upstream API prefix | `/api/v1` |
| `KEMONO_ACCEPT` | `Accept` header forwarded to Kemono | `text/css` |
| `VITE_DEV_SERVER_PORT` / `VITE_PORT` | Vite dev server port | `5173` |
| `VITE_PREVIEW_PORT` | Vite preview/built server port | `4173` |

Media URLs such as `/data/…` are automatically tunneled through the service at `/api/proxy/kemono/media/…`, so you normally do not need extra setup.

## Troubleshooting

- **Blank responses / timeouts**: make sure the service terminal is still running and that the UI is pointing to the same `PROXY_PORT`.
- **Port already in use**: edit `.env`, pick unused values, then rerun both `npm run proxy` and `npm run dev`.
- **Kemono mirror changed**: update `KEMONO_HOST` and (if needed) `KEMONO_BASE_PATH` to match the mirror you trust.
- **Slow initial loads**: enable caching inside the app for creators you follow; post data will be stored locally for quicker revisits.

## Developer notes

> These details are for contributors or anyone customizing the stack.

### Prerequisites

- Node.js 18+ (needed for the proxy's use of the global `fetch`)
- npm (bundled with Node)

### Install dependencies

```bash
cd kemono-peruse
npm install
```

### Run locally

Start the proxy from the project directory:

```bash
npm run proxy
```

Then run Vite:

```bash
cd kemono-peruse
npm run dev
```

Vite proxies `/api/proxy/kemono` to the Node proxy automatically, honoring whatever `PROXY_PORT` you set.

### Build for production

```bash
cd kemono-peruse
npm run build
```

### Preview the production build locally

After `npm run build`, either:

- Run the proxy and preview separately:

  ```bash
  npm run proxy
  npm run preview
  ```

- Or launch both together:

  ```bash
  npm run preview:all
  ```

Vite's preview server will host `dist/` (default `http://localhost:4173`, or whatever you set via `VITE_PREVIEW_PORT`). For remote hosting, upload `dist` to any static host and expose the proxy under `/api/proxy/kemono` on the same origin (or set `VITE_API_BASE` to wherever your proxy lives).
