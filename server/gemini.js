import { GoogleGenAI, Modality } from "@google/genai";

const dataUrlToBase64 = (href) => {
  const commaIndex = href.indexOf(",");
  return commaIndex >= 0 ? href.slice(commaIndex + 1) : href;
};

const errorToMessage = (error) => (error instanceof Error ? error.message : String(error));

const truncate = (value, maxLen) => {
  const text = String(value ?? "");
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
};

const summarizeResponseForLog = (response) => {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const first = candidates[0] ?? null;
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const partsSummary = parts.map((p) => ({
    hasText: typeof p?.text === "string" && p.text.length > 0,
    textPreview: typeof p?.text === "string" ? truncate(p.text, 120) : null,
    hasInlineData: Boolean(p?.inlineData?.data && p?.inlineData?.mimeType),
    inlineMimeType: typeof p?.inlineData?.mimeType === "string" ? p.inlineData.mimeType : null,
    inlineDataLength: typeof p?.inlineData?.data === "string" ? p.inlineData.data.length : null,
  }));

  return {
    candidatesCount: candidates.length,
    finishReason:
      typeof first?.finishReason === "string"
        ? first.finishReason
        : typeof first?.finishReason === "number"
          ? String(first.finishReason)
          : null,
    partsCount: parts.length,
    partsSummary,
  };
};

const pickGeneratedImagesFromResponse = (response) => {
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const images = [];
  for (const part of parts) {
    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
      images.push({ base64: part.inlineData.data, mimeType: part.inlineData.mimeType });
    }
  }
  return images;
};

export class GeminiRunner {
  constructor({ platforms }) {
    this.platforms = Array.isArray(platforms) ? platforms : [];
    this.clients = new Map();
  }

  getClient(platform) {
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

  async runWithFailover(operation, runner, startPlatformIndex = 0) {
    const errors = [];
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
    const details = errors.map((e) => `[${e.platformId}] ${errorToMessage(e.error)}`).join(" | ");
    const err = new Error(`${operation} failed on all platforms: ${details}`);
    err.statusCode = 502;
    throw err;
  }

  async editImage(request) {
    const images = Array.isArray(request?.images) ? request.images : [];
    const parts = images.map((img) => ({
      inlineData: { data: dataUrlToBase64(img.href), mimeType: img.mimeType },
    }));

    const mask = request?.mask
      ? { inlineData: { data: dataUrlToBase64(request.mask.href), mimeType: request.mask.mimeType } }
      : null;

    const text = { text: String(request?.prompt || "") };
    const promptParts = mask ? [text, ...parts, mask] : [...parts, text];

    const imageConfig =
      request?.aspectRatio || request?.imageSize
        ? {
            ...(request?.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
            ...(request?.imageSize ? { imageSize: request.imageSize } : {}),
          }
        : undefined;

    const response = await this.runWithFailover("editImage", async (platform, client) =>
      client.models.generateContent({
        model: platform.model,
        contents: [{ role: "user", parts: promptParts }],
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
          ...(imageConfig ? { imageConfig } : {}),
        },
      })
    );

    const generatedImages = pickGeneratedImagesFromResponse(response);
    const first = generatedImages[0];
    return {
      newImageBase64: first?.base64 ?? null,
      newImageMimeType: first?.mimeType ?? null,
      textResponse: null,
      generatedImages: generatedImages.length ? generatedImages : undefined,
    };
  }

  async generateImageFromText(request) {
    const desiredCount =
      typeof request?.imageCount === "number" ? Math.max(1, Math.min(4, Math.floor(request.imageCount))) : 1;

    const imageConfig =
      request?.aspectRatio || request?.imageSize
        ? {
            ...(request?.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
            ...(request?.imageSize ? { imageSize: request.imageSize } : {}),
          }
        : undefined;

    const generatedImages = [];
    for (let i = 0; i < desiredCount; i++) {
      const startPlatformIndex = this.platforms.length ? i % this.platforms.length : 0;
      let usedPlatform = null;
      const response = await this.runWithFailover(
        "generateImageFromText",
        async (platform, client) => {
          usedPlatform = platform;
          return client.models.generateContent({
            model: platform.model,
            contents: [{ role: "user", parts: [{ text: String(request?.prompt || "") }] }],
            config: {
              responseModalities: [Modality.TEXT, Modality.IMAGE],
              ...(imageConfig ? { imageConfig } : {}),
            },
          });
        },
        startPlatformIndex
      );

      const images = pickGeneratedImagesFromResponse(response);
      const first = images[0];
      if (!first) {
        console.warn("[gemini] generateImageFromText: response has no image data", {
          platform: usedPlatform
            ? { id: usedPlatform.id, baseUrl: usedPlatform.baseUrl, model: usedPlatform.model }
            : null,
          request: {
            promptPreview: truncate(request?.prompt, 120),
            aspectRatio: request?.aspectRatio ?? null,
            imageSize: request?.imageSize ?? null,
            imageCount: request?.imageCount ?? null,
          },
          response: summarizeResponseForLog(response),
        });
        const err = new Error("Gemini response did not include image data.");
        err.statusCode = 502;
        throw err;
      }
      generatedImages.push(first);
    }

    const first = generatedImages[0];
    return {
      newImageBase64: first?.base64 ?? null,
      newImageMimeType: first?.mimeType ?? null,
      textResponse: null,
      generatedImages: generatedImages.length ? generatedImages : undefined,
    };
  }

  async probePlatform(platform, timeoutMs = 180000) {
    const client = this.getClient(platform);
    const startedAt = Date.now();
    try {
      await client.models.generateContent({
        model: platform.model,
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        config: {
          responseModalities: [Modality.TEXT],
          httpOptions: { timeout: timeoutMs },
        },
      });
      return { ok: true, latencyMs: Date.now() - startedAt, errorMessage: null };
    } catch (error) {
      const name = typeof error?.name === "string" ? error.name : "";
      const msg = errorToMessage(error);
      const isTimeout =
        /timeout/i.test(name) || /timed out|timeout/i.test(msg);
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: isTimeout ? `probe timeout after ${timeoutMs}ms` : msg,
      };
    }
  }
}
