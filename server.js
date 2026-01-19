import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const PORT = process.env.PORT || 3000;
const FREESOUND_API_KEY = process.env.FREESOUND_API_KEY;

if (!FREESOUND_API_KEY) {
  console.warn(
    "[soundboard-backend] Missing FREESOUND_API_KEY env var. Requests will fail until it is set."
  );
}

app.use(express.json());

// --- Robust public/ directory resolution (fixes Cannot GET / on many deploy hosts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "public"); // public/ should be alongside server.js

/**
 * Serve frontend static files.
 * Backend + frontend deployed together: serve ./public here.
 */
app.use(express.static(publicDir));

// Ensure "/" serves index.html explicitly
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const FREESOUND_BASE = "https://freesound.org/apiv2";

function withKey(url) {
  const u = new URL(url);
  u.searchParams.set("token", FREESOUND_API_KEY || "");
  return u.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream error ${res.status}: ${text}`);
  }
  return res.json();
}

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/**
 * GET /api/popular?page=1
 * Returns 96 per page, popular sounds.
 */
app.get("/api/popular", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = 96;

    const fields = [
      "id",
      "name",
      "username",
      "duration",
      "previews",
      "license",
      "tags"
    ].join(",");

    const url = new URL(`${FREESOUND_BASE}/search/text/`);
    url.searchParams.set("query", "");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set("sort", "rating_desc");
    url.searchParams.set("fields", fields);

    const data = await fetchJson(withKey(url.toString()));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * GET /api/search?q=cat&page=1
 * Returns 96 per page.
 */
app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = 96;

    const fields = [
      "id",
      "name",
      "username",
      "duration",
      "previews",
      "license",
      "tags"
    ].join(",");

    const url = new URL(`${FREESOUND_BASE}/search/text/`);
    url.searchParams.set("query", q);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set("fields", fields);

    const data = await fetchJson(withKey(url.toString()));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * GET /api/sound/:id
 */
app.get("/api/sound/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const fields = [
      "id",
      "name",
      "username",
      "duration",
      "previews",
      "license",
      "tags",
      "url"
    ].join(",");

    const url = new URL(`${FREESOUND_BASE}/sounds/${encodeURIComponent(id)}/`);
    url.searchParams.set("fields", fields);

    const data = await fetchJson(withKey(url.toString()));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * GET /api/sound/:id/preview
 * Streams a preview MP3 (prefers HQ MP3 if available).
 * Adds cache headers so the Service Worker can store it for offline playback.
 */
app.get("/api/sound/:id/preview", async (req, res) => {
  try {
    const id = req.params.id;

    const fields = ["id", "previews"].join(",");
    const url = new URL(`${FREESOUND_BASE}/sounds/${encodeURIComponent(id)}/`);
    url.searchParams.set("fields", fields);

    const data = await fetchJson(withKey(url.toString()));
    const previews = data?.previews || {};

    const previewUrl =
      previews["preview-hq-mp3"] ||
      previews["preview-lq-mp3"] ||
      previews["preview-hq-ogg"] ||
      previews["preview-lq-ogg"];

    if (!previewUrl) {
      res.status(404).json({ error: "No preview available for this sound." });
      return;
    }

    const upstream = await fetch(previewUrl, {
      headers: req.headers.range ? { Range: req.headers.range } : undefined
    });

    if (!upstream.ok && upstream.status !== 206) {
      res.status(502).json({ error: `Preview fetch failed: ${upstream.status}` });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Accept-Ranges", "bytes");

    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    res.setHeader("Content-Type", contentType);

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    res.status(upstream.status);

    const body = upstream.body;
    if (!body) {
      res.end();
      return;
    }

    const reader = body.getReader();

    res.on("close", () => {
      try {
        reader.cancel();
      } catch {
        // ignore
      }
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`[soundboard-backend] listening on http://localhost:${PORT}`);
});
