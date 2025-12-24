import {
  GoogleGenAI,
  Modality,
  type GenerateContentResponse,
} from "@google/genai";
import type {
  AiService,
  EditImageRequest,
  EditImageResult,
  GenerateImageFromTextRequest,
  GenerateImageFromTextResult,
  GenerateVideoRequest,
  GenerateVideoResult,
  ImageInput,
  GeneratedImage,
} from "./ai/aiService";

export type GeminiPlatform = {
  /** 用于调试的可读 id（禁止包含密钥）。 */
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type GeminiAiServiceOptions = {
  /**
   * 多供应商配置（按优先级顺序）。
   * - 主程序通过 env 传入（`VITE_GEMINI_BASE_URLS`/`VITE_GEMINI_API_KEYS`/`VITE_GEMINI_MODELS`）
   */
  platforms?: GeminiPlatform[];

  /** 单平台兜底（用于 demo/旧入口）。 */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

const DEFAULT_BASE_URL = "https://grsai.dakka.com.cn/";
const DEFAULT_MODEL = "gemini-2.5-flash-image-preview";
const MAX_IMAGE_COUNT = 4;
const DEFAULT_FILL_MAX_TOTAL_ATTEMPTS = 40;

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

const normalizeGeminiBaseUrl = (value: string): string => (value.endsWith("/") ? value : `${value}/`);

const resolveEnvApiKeyFirst = (): string | undefined => {
  const list = splitEnvList(readEnv("VITE_GEMINI_API_KEYS"));
  if (list.length) return list[0];
  return readEnv("VITE_API_KEY") ?? readEnv("API_KEY");
};

const resolveEnvBaseUrlFirst = (): string | undefined => {
  const list = splitEnvList(readEnv("VITE_GEMINI_BASE_URLS"));
  if (list.length) return list[0];
  return readEnv("GENAI_BASE_URL");
};

const resolveEnvModelFirst = (): string | undefined => {
  const list = splitEnvList(readEnv("VITE_GEMINI_MODELS"));
  if (list.length) return list[0];
  return readEnv("GEMINI_MODEL");
};

const dataUrlToBase64 = (href: string): string => {
  const commaIndex = href.indexOf(",");
  return commaIndex >= 0 ? href.slice(commaIndex + 1) : href;
};

const errorToMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const buildAggregateError = (operation: string, errors: Array<{ platformId: string; error: unknown }>): Error => {
  const details = errors.map((e) => `[${e.platformId}] ${errorToMessage(e.error)}`).join(" | ");
  return new Error(`${operation} failed on all platforms: ${details}`);
};

const pickGeneratedImagesFromResponse = (response: GenerateContentResponse): GeneratedImage[] => {
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const images: GeneratedImage[] = [];
  for (const part of parts) {
    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
      images.push({ base64: part.inlineData.data, mimeType: part.inlineData.mimeType });
    }
  }
  return images;
};

export class GeminiAiService implements AiService {
  private readonly options: GeminiAiServiceOptions;
  private readonly platforms: GeminiPlatform[];
  private readonly clients = new Map<string, GoogleGenAI>();

  constructor(options: GeminiAiServiceOptions = {}) {
    this.options = options;
    this.platforms = this.resolvePlatforms();
    if (!this.platforms.length) throw new Error("Gemini platforms are not configured.");
  }

  private resolvePlatforms(): GeminiPlatform[] {
    if (this.options.platforms?.length) return this.options.platforms;

    const apiKey = this.options.apiKey ?? resolveEnvApiKeyFirst();
    if (!apiKey) {
      throw new Error(
        "Gemini API key is not set. Set `VITE_GEMINI_API_KEYS` (recommended) or provide `apiKey`."
      );
    }

    const baseUrl = normalizeGeminiBaseUrl(
      this.options.baseUrl ?? resolveEnvBaseUrlFirst() ?? DEFAULT_BASE_URL
    );
    const model = this.options.model ?? resolveEnvModelFirst() ?? DEFAULT_MODEL;

    return [{ id: `gemini#1:${baseUrl}`, baseUrl, apiKey, model }];
  }

  private getClient(platform: GeminiPlatform): GoogleGenAI {
    const cached = this.clients.get(platform.id);
    if (cached) return cached;
    const client = new GoogleGenAI({
      apiKey: platform.apiKey,
      vertexai: false,
      httpOptions: { baseUrl: platform.baseUrl },
    });
    this.clients.set(platform.id, client);
    return client;
  }

  private async runWithFailover<T>(
    operation: string,
    runner: (platform: GeminiPlatform, client: GoogleGenAI) => Promise<T>,
    startPlatformIndex = 0
  ): Promise<T> {
    const errors: Array<{ platformId: string; error: unknown }> = [];
    const count = this.platforms.length;
    for (let i = 0; i < count; i++) {
      const index = (startPlatformIndex + i) % count;
      const platform = this.platforms[index];
      const client = this.getClient(platform);
      try {
        return await runner(platform, client);
      } catch (error) {
        errors.push({ platformId: platform.id, error });
      }
    }
    throw buildAggregateError(operation, errors);
  }

  async editImage(request: EditImageRequest): Promise<EditImageResult> {
    const imageParts = request.images.map((image) => ({
      inlineData: {
        data: dataUrlToBase64(image.href),
        mimeType: image.mimeType,
      },
    }));

    const maskPart = request.mask
      ? {
          inlineData: {
            data: dataUrlToBase64(request.mask.href),
            mimeType: request.mask.mimeType,
          },
        }
      : null;

    const textPart = { text: request.prompt };

    const parts = maskPart ? [textPart, ...imageParts, maskPart] : [...imageParts, textPart];

    try {
      const response = await this.runWithFailover("editImage", async (platform, client) => {
        const imageConfig =
          request.aspectRatio || request.imageSize
            ? {
                ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
                ...(request.imageSize ? { imageSize: request.imageSize } : {}),
              }
            : undefined;

        return client.models.generateContent({
          model: platform.model,
          contents: [{ role: "user", parts }],
          config: {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
            ...(imageConfig ? { imageConfig } : {}),
          },
        });
      });

      const generatedImages = pickGeneratedImagesFromResponse(response);
      const first = generatedImages[0];
      return {
        newImageBase64: first?.base64 ?? null,
        newImageMimeType: first?.mimeType ?? null,
        textResponse: null,
        generatedImages: generatedImages.length ? generatedImages : undefined,
      };
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      if (error instanceof Error) throw new Error(`Gemini API Error: ${error.message}`);
      throw new Error("An unknown error occurred while contacting the Gemini API.");
    }
  }

  async generateImageFromText(request: GenerateImageFromTextRequest): Promise<GenerateImageFromTextResult> {
    try {
      const desiredCount =
        typeof request.imageCount === "number"
          ? Math.max(1, Math.min(MAX_IMAGE_COUNT, Math.floor(request.imageCount)))
          : 1;

      const imageConfig =
        request.aspectRatio || request.imageSize
          ? {
              ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
              ...(request.imageSize ? { imageSize: request.imageSize } : {}),
            }
          : undefined;

      const maxTotalAttempts =
        Number.parseInt(readEnv("VITE_GEMINI_FILL_MAX_TOTAL_ATTEMPTS") ?? "", 10) ||
        DEFAULT_FILL_MAX_TOTAL_ATTEMPTS;
      if (!Number.isFinite(maxTotalAttempts) || maxTotalAttempts < desiredCount) {
        throw new Error("Invalid VITE_GEMINI_FILL_MAX_TOTAL_ATTEMPTS; must be a positive integer.");
      }

      const parts = [{ text: request.prompt }];

      const generatedImages: GeneratedImage[] = [];
      const errors: Array<{ platformId: string; error: unknown }> = [];
      let attempts = 0;

      while (generatedImages.length < desiredCount) {
        const remaining = desiredCount - generatedImages.length;
        const parallel = Math.min(remaining, desiredCount);
        if (attempts + parallel > maxTotalAttempts) break;

        const tasks = Array.from({ length: parallel }).map(async (_, idx) => {
          const startPlatformIndex = (attempts + idx) % this.platforms.length;
          const response = await this.runWithFailover(
            "generateImageFromText",
            async (platform, client) =>
              client.models.generateContent({
                model: platform.model,
                contents: [{ role: "user", parts }],
                config: {
                  responseModalities: [Modality.TEXT, Modality.IMAGE],
                  ...(imageConfig ? { imageConfig } : {}),
                },
              }),
            startPlatformIndex
          );

          const images = pickGeneratedImagesFromResponse(response);
          const first = images[0];
          if (!first) throw new Error("Gemini response did not include image data.");
          return first;
        });

        const settled = await Promise.allSettled(tasks);
        attempts += parallel;

        for (const item of settled) {
          if (item.status === "fulfilled") {
            generatedImages.push(item.value);
          } else {
            errors.push({ platformId: "unknown", error: item.reason });
          }
        }

        if (generatedImages.length < desiredCount) {
          const delayMs = Math.min(2000, 200 + attempts * 50);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      if (generatedImages.length < desiredCount) {
        throw buildAggregateError(
          `generateImageFromText (filled ${generatedImages.length}/${desiredCount})`,
          errors.length ? errors : [{ platformId: "unknown", error: "unknown error" }]
        );
      }

      const first = generatedImages[0];
      return {
        newImageBase64: first?.base64 ?? null,
        newImageMimeType: first?.mimeType ?? null,
        textResponse: null,
        generatedImages,
      };
    } catch (error) {
      console.error("Error calling Gemini API for text-to-image:", error);
      if (error instanceof Error) throw new Error(`Gemini API Error: ${error.message}`);
      throw new Error("An unknown error occurred while contacting the Gemini API.");
    }
  }

  async generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResult> {
    request.onProgress("Video generation is not supported.");
    throw new Error("Video generation is not supported.");
  }
}

export const createGeminiAiService = (options: GeminiAiServiceOptions = {}): AiService => new GeminiAiService(options);

const defaultGeminiService = createGeminiAiService();

export async function editImage(images: ImageInput[], prompt: string, mask?: ImageInput): Promise<EditImageResult> {
  return defaultGeminiService.editImage({ images, prompt, mask });
}

export async function generateImageFromText(prompt: string): Promise<GenerateImageFromTextResult> {
  return defaultGeminiService.generateImageFromText({ prompt });
}

export async function generateVideo(
  prompt: string,
  aspectRatio: "16:9" | "9:16",
  onProgress: (message: string) => void,
  image?: ImageInput
): Promise<GenerateVideoResult> {
  return defaultGeminiService.generateVideo({ prompt, aspectRatio, onProgress, image });
}
