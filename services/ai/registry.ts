import type { AiService } from "./aiService";
import { createGeminiAiService } from "../geminiService";

export type AiProviderId = "gemini";

export type AiProviderOption = {
  id: AiProviderId;
  labelKey: string;
  supportsVideo: boolean;
};

export const AI_PROVIDER_OPTIONS: AiProviderOption[] = [
  { id: "gemini", labelKey: "ai.providers.gemini", supportsVideo: false },
];

export const isAiProviderId = (value: unknown): value is AiProviderId =>
  value === "gemini";

const providerById: Record<AiProviderId, AiProviderOption> = { gemini: AI_PROVIDER_OPTIONS[0] };

export const providerSupportsVideo = (id: AiProviderId): boolean => providerById[id].supportsVideo;

const instances: Partial<Record<AiProviderId, AiService>> = {};

type PlatformConfig = { baseUrl: string; apiKey: string; model: string };

const splitEnvList = (value?: string): string[] =>
  (value ?? "")
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);

const readEnv = (key: string): string | undefined => {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return viteEnv?.[key] ?? processEnv?.[key];
};

const requireEnvList = (key: string): string[] => {
  const list = splitEnvList(readEnv(key));
  if (!list.length) throw new Error(`Missing required env: ${key} (comma/newline separated list).`);
  return list;
};

const normalizeGeminiBaseUrl = (value: string): string => (value.endsWith("/") ? value : `${value}/`);

const zipPlatforms = (
  provider: AiProviderId,
  baseUrls: string[],
  apiKeys: string[],
  models: string[],
  normalizeBaseUrl: (v: string) => string,
): PlatformConfig[] => {
  const count = Math.max(baseUrls.length, apiKeys.length, models.length);
  const resolvedCount = count || 1;
  const firstBaseUrl = baseUrls[0];
  const firstApiKey = apiKeys[0];
  const firstModel = models[0];

  const platforms: PlatformConfig[] = [];
  for (let i = 0; i < resolvedCount; i++) {
    const baseUrl = baseUrls[i] ?? firstBaseUrl;
    const apiKey = apiKeys[i] ?? firstApiKey;
    const model = models[i] ?? firstModel;
    if (!baseUrl) throw new Error(`${provider}: missing baseUrl at index ${i}`);
    if (!apiKey) throw new Error(`${provider}: missing apiKey at index ${i}`);
    if (!model) throw new Error(`${provider}: missing model at index ${i}`);
    platforms.push({ baseUrl: normalizeBaseUrl(baseUrl), apiKey, model });
  }
  return platforms;
};

const platformId = (provider: AiProviderId, baseUrl: string, index: number): string =>
  `${provider}#${index + 1}:${baseUrl}`;

const createGeminiFromEnv = (): AiService => {
  const baseUrls = requireEnvList("VITE_GEMINI_BASE_URLS");
  const apiKeys = requireEnvList("VITE_GEMINI_API_KEYS");
  const models = requireEnvList("VITE_GEMINI_MODELS");
  const platforms = zipPlatforms("gemini", baseUrls, apiKeys, models, normalizeGeminiBaseUrl);

  return createGeminiAiService({
    platforms: platforms.map((p, index) => ({
      id: platformId("gemini", p.baseUrl, index),
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
    })),
  });
};

export const getAiService = (id: AiProviderId): AiService => {
  if (!instances[id]) {
    instances[id] = createGeminiFromEnv();
  }
  return instances[id]!;
};
