import fs from "node:fs";
import path from "node:path";
import util from "node:util";

const DEFAULT_LOG_FILE = "./logs/bananapod.log";

let stream = null;
let installed = false;

const getLogFilepath = () => process.env.BANANAPOD_LOG_FILE || DEFAULT_LOG_FILE;

const shouldEchoToConsole = () => process.env.BANANAPOD_LOG_TO_CONSOLE === "1";

const INSPECT_OPTIONS = {
  depth: null,
  colors: false,
  compact: false,
  breakLength: Infinity,
  maxArrayLength: null,
  maxStringLength: null,
};

const formatArgs = (args) => {
  if (typeof util.formatWithOptions === "function") return util.formatWithOptions(INSPECT_OPTIONS, ...args);
  return util.format(...args);
};

const ensureStream = () => {
  if (stream) return stream;
  const filepath = getLogFilepath();
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  stream = fs.createWriteStream(filepath, { flags: "a", encoding: "utf8" });
  process.on("exit", () => {
    try {
      stream?.end();
    } catch {
      // ignore
    }
  });
  return stream;
};

const nowIso = () => new Date().toISOString();

const writeLine = (line) => {
  const s = ensureStream();
  s.write(`${line}\n`);
};

const truncateText = (text, maxLen) => {
  const s = String(text ?? "");
  if (!Number.isFinite(maxLen) || maxLen <= 0) return { text: s, truncated: false };
  if (s.length <= maxLen) return { text: s, truncated: false };
  return { text: `${s.slice(0, Math.max(0, maxLen - 1))}…`, truncated: true };
};

const getRawMaxChars = (envKey) => {
  const raw = process.env[envKey];
  if (!raw) return 0; // 0=不截断
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const isRawLoggingEnabled = () => process.env.BANANAPOD_LOG_RAW !== "0";

// 写入“原文块”到日志文件（用于保留请求/响应原始内容）。
export const appendRawBlock = (title, text, { traceId, operation, envMaxCharsKey } = {}) => {
  if (!isRawLoggingEnabled()) return;

  const maxChars = envMaxCharsKey ? getRawMaxChars(envMaxCharsKey) : 0;
  const { text: body, truncated } = truncateText(text, maxChars);

  writeLine(`[${nowIso()}] RAW ${operation || "-"} traceId=${traceId || "-"} ${title}`);
  if (truncated) writeLine(`[${nowIso()}] RAW truncated maxChars=${maxChars}`);
  writeLine(body);
  writeLine(`[${nowIso()}] RAW END ${title}`);
};

// 把 console 输出同时写入日志文件（JSON/对象会走 util.format 生成可读文本）。
export const installConsoleFileLogger = () => {
  if (installed) return;
  installed = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  };

  const wrap = (level, fn) => {
    return (...args) => {
      try {
        const msg = formatArgs(args);
        writeLine(`[${nowIso()}] ${level.toUpperCase()} ${msg}`);
      } catch (e) {
        writeLine(
          `[${nowIso()}] ${level.toUpperCase()} <log format failed: ${e instanceof Error ? e.message : String(e)}>`
        );
      }
      if (shouldEchoToConsole()) return fn(...args);
      return undefined;
    };
  };

  console.log = wrap("info", original.log);
  console.info = wrap("info", original.info);
  console.warn = wrap("warn", original.warn);
  console.error = wrap("error", original.error);
  console.debug = wrap("debug", original.debug);
};
