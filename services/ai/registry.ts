import type { AiService } from "./aiService";
import { createGeminiAiService } from "../geminiService";
import { createNanoBananaAiService } from "../nanoBananaService";
import { createFailoverAiService, type FailoverPlatform } from "./failover";

export type AiProviderId = "gemini" | "nanoBanana";

export type AiProviderOption = {
  id: AiProviderId;
  labelKey: string;
  supportsVideo: boolean;
};

export const AI_PROVIDER_OPTIONS: AiProviderOption[] = [
  { id: "gemini", labelKey: "ai.providers.gemini", supportsVideo: true },
  { id: "nanoBanana", labelKey: "ai.providers.nanoBanana", supportsVideo: false },
];

export const isAiProviderId = (value: unknown): value is AiProviderId =>
  value === "gemini" || value === "nanoBanana";

const providerById: Record<AiProviderId, AiProviderOption> = {
  gemini: AI_PROVIDER_OPTIONS[0],
  nanoBanana: AI_PROVIDER_OPTIONS[1],
};

export const providerSupportsVideo = (id: AiProviderId): boolean => providerById[id].supportsVideo;

const instances: Partial<Record<AiProviderId, AiService>> = {};

type PlatformConfig = { baseUrl: string; apiKey: string };

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

const normalizeNanoBananaBaseUrl = (value: string): string => value.replace(/\/+$/, "");
const normalizeGeminiBaseUrl = (value: string): string => (value.endsWith("/") ? value : `${value}/`);

const zipPlatforms = (
  provider: AiProviderId,
  baseUrls: string[],
  apiKeys: string[],
  normalizeBaseUrl: (v: string) => string
): PlatformConfig[] => {
  const count = Math.max(baseUrls.length, apiKeys.length);
  const resolvedCount = count || 1;
  const firstBaseUrl = baseUrls[0];
  const firstApiKey = apiKeys[0];

  const platforms: PlatformConfig[] = [];
  for (let i = 0; i < resolvedCount; i++) {
    const baseUrl = baseUrls[i] ?? firstBaseUrl;
    const apiKey = apiKeys[i] ?? firstApiKey;
    if (!baseUrl) throw new Error(`${provider}: missing baseUrl at index ${i}`);
    if (!apiKey) throw new Error(`${provider}: missing apiKey at index ${i}`);
    platforms.push({ baseUrl: normalizeBaseUrl(baseUrl), apiKey });
  }
  return platforms;
};

const platformId = (provider: AiProviderId, baseUrl: string, index: number): string => `${provider}#${index + 1}:${baseUrl}`;

const createFailoverGemini = (): AiService => {
  const baseUrls = requireEnvList("VITE_GEMINI_BASE_URLS");
  const apiKeys = requireEnvList("VITE_GEMINI_API_KEYS");
  const platforms = zipPlatforms("gemini", baseUrls, apiKeys, normalizeGeminiBaseUrl);

  const services: Array<FailoverPlatform<AiService>> = platforms.map((p, index) => ({
    id: platformId("gemini", p.baseUrl, index),
    service: createGeminiAiService({ baseUrl: p.baseUrl, apiKey: p.apiKey }),
  }));
  return createFailoverAiService(services);
};

const createFailoverNanoBanana = (): AiService => {
  const baseUrls = requireEnvList("VITE_NANO_BANANA_BASE_URLS");
  const apiKeys = requireEnvList("VITE_NANO_BANANA_API_KEYS");
  const platforms = zipPlatforms("nanoBanana", baseUrls, apiKeys, normalizeNanoBananaBaseUrl);

  const services: Array<FailoverPlatform<AiService>> = platforms.map((p, index) => ({
    id: platformId("nanoBanana", p.baseUrl, index),
    service: createNanoBananaAiService({ baseUrl: p.baseUrl, apiKey: p.apiKey }),
  }));
  return createFailoverAiService(services);
};

export const getAiService = (id: AiProviderId): AiService => {
  if (!instances[id]) {
    instances[id] = id === "gemini" ? createFailoverGemini() : createFailoverNanoBanana();
  }
  return instances[id]!;
};
