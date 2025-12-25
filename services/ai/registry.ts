import type { AiService } from "./aiService";
import { BackendGeminiAiService } from "./backendGeminiService";

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

export const getAiService = (id: AiProviderId): AiService => {
  if (!instances[id]) {
    instances[id] = new BackendGeminiAiService();
  }
  return instances[id]!;
};
