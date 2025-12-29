import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clearSessionCookie, createSessionCookie, isLoggedIn, verifyPassword } from "./auth.js";
import { getGeminiPlatforms, getGeminiPlatformsRedacted, upsertGeminiPlatforms } from "./config.js";
import { GeminiRunner } from "./gemini.js";
import { GeminiMonitor } from "./monitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT || process.env.BANANAPOD_PORT || 8787);
const REQUIRE_AUTH_FOR_AI = process.env.BANANAPOD_REQUIRE_AUTH_FOR_AI !== "0";
const STATIC_DIR = process.env.BANANAPOD_STATIC_DIR || path.join(repoRoot, "dist");

const json = (res, statusCode, payload, headers = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
};

const readBodyJson = async (req, { limitBytes = 20 * 1024 * 1024 } = {}) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error("请求体过大");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("无效的 JSON");
    error.statusCode = 400;
    throw error;
  }
};

const sendFile = async (res, filepath) => {
  const data = await fs.readFile(filepath);
  const ext = path.extname(filepath).toLowerCase();
  const typeByExt = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".map": "application/octet-stream",
  };
  res.writeHead(200, { "Content-Type": typeByExt[ext] || "application/octet-stream" });
  res.end(data);
};

const requireLogin = (req) => {
  if (!isLoggedIn(req)) {
    const error = new Error("未登录");
    error.statusCode = 401;
    throw error;
  }
};

const monitor = new GeminiMonitor({
  getPlatforms: getGeminiPlatforms,
  probeTimeoutMs: process.env.BANANAPOD_MONITOR_PROBE_TIMEOUT_MS || 180000,
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method || "GET").toUpperCase();

    if (pathname === "/api/health") return json(res, 200, { ok: true });

    if (pathname === "/api/auth/me" && method === "GET") {
      return json(res, 200, { ok: true, loggedIn: isLoggedIn(req) });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await readBodyJson(req, { limitBytes: 1024 * 16 });
      if (!verifyPassword(body.password)) return json(res, 401, { ok: false, message: "密码错误" });
      return json(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": createSessionCookie(),
        }
      );
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      return json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    }

    if (pathname === "/api/admin/gemini/platforms" && method === "GET") {
      requireLogin(req);
      const platforms = await getGeminiPlatformsRedacted();
      return json(res, 200, { ok: true, platforms });
    }

    if (pathname === "/api/admin/gemini/platforms" && method === "PUT") {
      requireLogin(req);
      const body = await readBodyJson(req);
      const platforms = await upsertGeminiPlatforms(body.platforms);
      return json(res, 200, { ok: true, platforms });
    }

    if (pathname === "/api/monitor/gemini" && method === "GET") {
      requireLogin(req);
      return json(res, 200, { ok: true, status: monitor.getStatusSnapshot() });
    }

    if (pathname === "/api/monitor/gemini/check" && method === "POST") {
      requireLogin(req);
      const status = await monitor.checkOnce();
      return json(res, 200, { ok: true, status });
    }

    if (pathname === "/api/ai/gemini/edit-image" && method === "POST") {
      if (REQUIRE_AUTH_FOR_AI) requireLogin(req);
      const body = await readBodyJson(req);
      const platforms = await getGeminiPlatforms();
      if (!platforms.length) {
        const error = new Error("Gemini 未配置：请先在设置里添加平台/密钥/模型");
        error.statusCode = 400;
        throw error;
      }
      const runner = new GeminiRunner({ platforms });
      const result = await runner.editImage(body);
      return json(res, 200, { ok: true, result });
    }

    if (pathname === "/api/ai/gemini/generate-image" && method === "POST") {
      if (REQUIRE_AUTH_FOR_AI) requireLogin(req);
      const body = await readBodyJson(req);
      const platforms = await getGeminiPlatforms();
      if (!platforms.length) {
        const error = new Error("Gemini 未配置：请先在设置里添加平台/密钥/模型");
        error.statusCode = 400;
        throw error;
      }
      const runner = new GeminiRunner({ platforms });
      const result = await runner.generateImageFromText(body);
      return json(res, 200, { ok: true, result });
    }

    if (method === "GET") {
      const safePath = pathname.replaceAll("..", "");
      const candidate = path.join(STATIC_DIR, safePath);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return await sendFile(res, candidate);
      } catch {
        // ignore
      }

      const indexFile = path.join(STATIC_DIR, "index.html");
      try {
        return await sendFile(res, indexFile);
      } catch {
        return json(res, 404, { ok: false, message: "Not Found" });
      }
    }

    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (error) {
    const statusCode = error?.statusCode && Number.isFinite(error.statusCode) ? error.statusCode : 500;
    return json(res, statusCode, { ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[BananaPod server] listening on http://0.0.0.0:${PORT}`);
  console.log(`[BananaPod server] static: ${STATIC_DIR}`);
});
