import type { AiService } from "./aiService";
import { createGeminiAiService } from "../geminiService";
import { createNanoBananaAiService } from "../nanoBananaService";

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

export const getAiService = (id: AiProviderId): AiService => {
  if (!instances[id]) {
    instances[id] = id === "gemini" ? createGeminiAiService() : createNanoBananaAiService();
  }
  return instances[id]!;
};

