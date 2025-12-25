import crypto from "node:crypto";

const COOKIE_NAME = "bp_session";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 天

const base64UrlEncode = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const base64UrlDecodeToString = (value) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
};

const getSecret = () => {
  const secret = process.env.BANANAPOD_AUTH_SECRET || "";
  if (secret) return secret;
  const password = process.env.BANANAPOD_ADMIN_PASSWORD || "";
  if (password) return password;
  return "";
};

export const parseCookies = (cookieHeader) => {
  const cookies = {};
  const header = typeof cookieHeader === "string" ? cookieHeader : "";
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = value;
  });
  return cookies;
};

const sign = (secret, payload) => base64UrlEncode(crypto.createHmac("sha256", secret).update(payload).digest());

export const createSessionCookie = ({ ttlSeconds = DEFAULT_TTL_SECONDS } = {}) => {
  const secret = getSecret();
  if (!secret) {
    const error = new Error("服务端未设置 BANANAPOD_AUTH_SECRET 或 BANANAPOD_ADMIN_PASSWORD，无法启用登录。");
    error.statusCode = 500;
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  const payloadObj = { iat: now, exp: now + ttlSeconds };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));
  const token = `${payload}.${sign(secret, payload)}`;

  const cookie = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${ttlSeconds}`,
  ];

  if (process.env.BANANAPOD_COOKIE_SECURE === "1") cookie.push("Secure");
  return cookie.join("; ");
};

export const clearSessionCookie = () =>
  `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;

export const isLoggedIn = (req) => {
  const secret = getSecret();
  if (!secret) return false;

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;

  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig !== sign(secret, payload)) return false;

  try {
    const raw = base64UrlDecodeToString(payload);
    const data = JSON.parse(raw);
    const exp = typeof data?.exp === "number" ? data.exp : 0;
    return exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
};

export const verifyPassword = (password) => {
  const expected = process.env.BANANAPOD_ADMIN_PASSWORD || "";
  if (!expected) {
    const error = new Error("服务端未设置 BANANAPOD_ADMIN_PASSWORD，无法登录。");
    error.statusCode = 500;
    throw error;
  }
  return String(password || "") === expected;
};

