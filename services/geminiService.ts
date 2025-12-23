import {
  GoogleGenAI,
  Modality,
  type GenerateContentResponse,
  type GenerateVideosOperation,
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

export type GeminiAiServiceOptions = {
  apiKey?: string;
  baseUrl?: string;
};

const DEFAULT_BASE_URL = "https://grsai.dakka.com.cn/";

const resolveEnvApiKey = (): string | undefined => {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return viteEnv?.VITE_API_KEY ?? viteEnv?.API_KEY ?? processEnv?.API_KEY ?? processEnv?.VITE_API_KEY;
};

const dataUrlToBase64 = (href: string): string => {
  const commaIndex = href.indexOf(",");
  return commaIndex >= 0 ? href.slice(commaIndex + 1) : href;
};

export class GeminiAiService implements AiService {
  private readonly options: GeminiAiServiceOptions;
  private client: GoogleGenAI | null = null;
  private resolvedApiKey: string | null = null;

  constructor(options: GeminiAiServiceOptions = {}) {
    this.options = options;
  }

  private getApiKey(): string {
    if (this.resolvedApiKey) return this.resolvedApiKey;
    const apiKey = this.options.apiKey ?? resolveEnvApiKey();
    if (!apiKey) throw new Error("API key is not set. Provide `apiKey` or set `VITE_API_KEY`/`API_KEY`.");
    this.resolvedApiKey = apiKey;
    return apiKey;
  }

  private getClient(): GoogleGenAI {
    if (this.client) return this.client;
    const apiKey = this.getApiKey();
    this.client = new GoogleGenAI({
      apiKey,
      vertexai: false,
      httpOptions: { baseUrl: this.options.baseUrl ?? DEFAULT_BASE_URL },
    });
    return this.client;
  }

  async editImage(request: EditImageRequest): Promise<EditImageResult> {
    const client = this.getClient();

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
      const response: GenerateContentResponse = await client.models.generateContent({
        model: "gemini-2.5-flash-image-preview",
        contents: { parts },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
      });

      let newImageBase64: string | null = null;
      let newImageMimeType: string | null = null;
      let textResponse: string | null = null;
      const generatedImages: GeneratedImage[] = [];

      if (response.candidates?.length && response.candidates[0].content) {
        const responseParts = response.candidates[0].content.parts;
        for (const part of responseParts) {
          if (part.inlineData) {
            newImageBase64 = part.inlineData.data;
            newImageMimeType = part.inlineData.mimeType;
            if (newImageBase64 && newImageMimeType) {
              generatedImages.push({ base64: newImageBase64, mimeType: newImageMimeType });
            }
          } else if (part.text) {
            textResponse = part.text;
          }
        }
      } else {
        textResponse = "The AI response was blocked or did not contain content.";
        if (response.candidates?.length && response.candidates[0].finishReason) {
          textResponse += ` (Reason: ${response.candidates[0].finishReason})`;
        }
      }

      if (!newImageBase64) {
        console.warn("API response did not contain an image part.", response);
        textResponse = textResponse || "The AI did not generate a new image. Please try a different prompt.";
      }

      return { newImageBase64, newImageMimeType, textResponse, generatedImages: generatedImages.length ? generatedImages : undefined };
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      if (error instanceof Error) throw new Error(`Gemini API Error: ${error.message}`);
      throw new Error("An unknown error occurred while contacting the Gemini API.");
    }
  }

  async generateImageFromText(request: GenerateImageFromTextRequest): Promise<GenerateImageFromTextResult> {
    const client = this.getClient();

    try {
      const desiredCount =
        typeof request.imageCount === "number" ? Math.max(1, Math.min(4, Math.floor(request.imageCount))) : 1;
      const response = await client.models.generateImages({
        model: "imagen-4.0-generate-001",
        prompt: request.prompt,
        config: {
          numberOfImages: desiredCount,
          outputMimeType: "image/png",
        },
      });

      if (response.generatedImages?.length) {
        const generatedImages: GeneratedImage[] = response.generatedImages
          .slice(0, desiredCount)
          .map((img) => ({ base64: img.image.imageBytes, mimeType: "image/png" }));

        const first = generatedImages[0];
        return {
          newImageBase64: first?.base64 ?? null,
          newImageMimeType: first?.mimeType ?? null,
          textResponse: null,
          generatedImages,
        };
      }

      return {
        newImageBase64: null,
        newImageMimeType: null,
        textResponse: "The AI did not generate an image. Please try a different prompt.",
      };
    } catch (error) {
      console.error("Error calling Gemini API for text-to-image:", error);
      if (error instanceof Error) throw new Error(`Gemini API Error: ${error.message}`);
      throw new Error("An unknown error occurred while contacting the Gemini API.");
    }
  }

  async generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResult> {
    const client = this.getClient();
    const apiKey = this.getApiKey();

    request.onProgress("Initializing video generation...");

    const imagePart = request.image
      ? {
          imageBytes: dataUrlToBase64(request.image.href),
          mimeType: request.image.mimeType,
        }
      : undefined;

    let operation: GenerateVideosOperation = await client.models.generateVideos({
      model: "veo-2.0-generate-001",
      prompt: request.prompt,
      image: imagePart,
      config: {
        numberOfVideos: 1,
        aspectRatio: request.aspectRatio,
      },
    });

    const progressMessages = ["Rendering frames...", "Compositing video...", "Applying final touches...", "Almost there..."];
    let messageIndex = 0;

    request.onProgress("Generation started, this may take a few minutes.");

    while (!operation.done) {
      request.onProgress(progressMessages[messageIndex % progressMessages.length]);
      messageIndex++;
      await new Promise((resolve) => setTimeout(resolve, 10000));
      operation = await client.operations.getVideosOperation({ operation });
    }

    if (operation.error) throw new Error(`Video generation failed: ${operation.error.message}`);

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Video generation completed, but no download link was found.");

    request.onProgress("Downloading generated video...");
    const response = await fetch(`${downloadLink}&key=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);

    const videoBlob = await response.blob();
    const mimeType = response.headers.get("Content-Type") || "video/mp4";

    return { videoBlob, mimeType };
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
