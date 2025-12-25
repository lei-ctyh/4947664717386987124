import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_PATH = "./.bananapod.config.json";

const normalizeBaseUrl = (value) => (value.endsWith("/") ? value : `${value}/`);

const redactApiKey = (value) => {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};

const ensureDir = async (filepath) => {
  const dir = path.dirname(filepath);
  await fs.mkdir(dir, { recursive: true });
};

const readJsonFile = async (filepath) => {
  try {
    const raw = await fs.readFile(filepath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
};

const writeJsonFile = async (filepath, value) => {
  await ensureDir(filepath);
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filepath, raw, "utf8");
};

export const getConfigPath = () => process.env.BANANAPOD_CONFIG_PATH || DEFAULT_CONFIG_PATH;

export const loadConfig = async () => {
  const filepath = getConfigPath();
  const cfg = await readJsonFile(filepath);
  if (cfg && typeof cfg === "object") return cfg;
  return { providers: { gemini: { platforms: [] } } };
};

export const saveConfig = async (cfg) => {
  const filepath = getConfigPath();
  await writeJsonFile(filepath, cfg);
};

const platformId = (baseUrl, model, index) => `gemini#${index + 1}:${baseUrl}|${model}`;

const coerceGeminiPlatforms = (input) => {
  const rawList = Array.isArray(input) ? input : [];
  const platforms = rawList.map((p) => ({
    id: typeof p?.id === "string" ? p.id : "",
    baseUrl: typeof p?.baseUrl === "string" ? normalizeBaseUrl(p.baseUrl.trim()) : "",
    model: typeof p?.model === "string" ? p.model.trim() : "",
    apiKey: typeof p?.apiKey === "string" ? p.apiKey.trim() : "",
  }));

  const errors = [];
  platforms.forEach((p, idx) => {
    if (!p.baseUrl) errors.push(`platforms[${idx}].baseUrl 不能为空`);
    if (!p.model) errors.push(`platforms[${idx}].model 不能为空`);
  });
  if (errors.length) {
    const error = new Error(errors.join("; "));
    error.statusCode = 400;
    throw error;
  }

  platforms.forEach((p, idx) => {
    if (!p.id) p.id = platformId(p.baseUrl, p.model, idx);
  });

  return platforms;
};

export const getGeminiPlatforms = async () => {
  const cfg = await loadConfig();
  const list = cfg?.providers?.gemini?.platforms;
  const platforms = Array.isArray(list) ? list : [];
  return platforms
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      id: String(p.id || ""),
      baseUrl: normalizeBaseUrl(String(p.baseUrl || "")),
      model: String(p.model || ""),
      apiKey: String(p.apiKey || ""),
    }))
    .filter((p) => p.id && p.baseUrl && p.model && p.apiKey);
};

export const getGeminiPlatformsRedacted = async () => {
  const platforms = await getGeminiPlatforms();
  return platforms.map((p) => ({
    id: p.id,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKeyMasked: redactApiKey(p.apiKey),
    hasApiKey: Boolean(p.apiKey),
  }));
};

export const upsertGeminiPlatforms = async (platformsInput) => {
  const nextPlatforms = coerceGeminiPlatforms(platformsInput);
  const currentPlatforms = await getGeminiPlatforms();
  const currentById = new Map(currentPlatforms.map((p) => [p.id, p]));

  const merged = nextPlatforms.map((p) => {
    const current = currentById.get(p.id);
    const apiKey = p.apiKey || current?.apiKey || "";
    if (!apiKey) {
      const error = new Error(`platform ${p.id}: 缺少 apiKey（新增平台必须填写，已有平台可留空表示不变）`);
      error.statusCode = 400;
      throw error;
    }
    return { id: p.id, baseUrl: p.baseUrl, model: p.model, apiKey };
  });

  const cfg = await loadConfig();
  cfg.providers ||= {};
  cfg.providers.gemini ||= {};
  cfg.providers.gemini.platforms = merged;
  await saveConfig(cfg);

  return getGeminiPlatformsRedacted();
};

