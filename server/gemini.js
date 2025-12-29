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

const makeTraceId = (operation) =>
  `${operation}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

const normalizeAspectRatio = (value) => {
  const ratio = String(value ?? "").trim();
  if (!ratio || ratio === "auto") return undefined;
  return ratio;
};

const normalizeImageSize = (value) => {
  const size = String(value ?? "").trim();
  if (!size) return undefined;
  if (/^\d+x\d+$/i.test(size)) return size;
  const map = {
    "1K": "1024x1024",
    "2K": "2048x2048",
    "4K": "4096x4096",
  };
  return map[size] || undefined;
};

const buildImageConfig = ({ aspectRatio, imageSize } = {}) => {
  const next = {};
  const ar = normalizeAspectRatio(aspectRatio);
  const sz = normalizeImageSize(imageSize);
  if (ar) next.aspectRatio = ar;
  if (sz) next.imageSize = sz;
  return Object.keys(next).length ? next : undefined;
};

const summarizePartsForLog = (parts, { maxParts = 8 } = {}) => {
  const list = Array.isArray(parts) ? parts : [];
  const sample = list.slice(0, Math.max(0, maxParts)).map((p) => ({
    hasText: typeof p?.text === "string" && p.text.length > 0,
    textPreview: typeof p?.text === "string" ? truncate(p.text, 120) : null,
    hasInlineData: Boolean(p?.inlineData?.data && p?.inlineData?.mimeType),
    inlineMimeType: typeof p?.inlineData?.mimeType === "string" ? p.inlineData.mimeType : null,
    inlineDataLength: typeof p?.inlineData?.data === "string" ? p.inlineData.data.length : null,
  }));
  return {
    partsCount: list.length,
    partsSample: sample,
    partsTruncated: list.length > sample.length,
  };
};

const summarizeGenerateContentParamsForLog = (params) => {
  const contents = Array.isArray(params?.contents) ? params.contents : [];
  const contentsSample = contents.slice(0, 2).map((c) => ({
    role: typeof c?.role === "string" ? c.role : null,
    ...summarizePartsForLog(c?.parts, { maxParts: 6 }),
  }));

  const config = params?.config && typeof params.config === "object" ? params.config : null;
  const responseModalities = Array.isArray(config?.responseModalities)
    ? config.responseModalities.map((m) => String(m))
    : null;

  const imageConfig = config?.imageConfig && typeof config.imageConfig === "object" ? config.imageConfig : null;
  const httpOptions = config?.httpOptions && typeof config.httpOptions === "object" ? config.httpOptions : null;

  return {
    model: typeof params?.model === "string" ? params.model : null,
    contentsCount: contents.length,
    contentsSample,
    responseModalities,
    imageConfig: imageConfig
      ? {
          aspectRatio: typeof imageConfig.aspectRatio === "string" ? imageConfig.aspectRatio : null,
          imageSize: typeof imageConfig.imageSize === "string" ? imageConfig.imageSize : null,
          outputMimeType: typeof imageConfig.outputMimeType === "string" ? imageConfig.outputMimeType : null,
          outputCompressionQuality:
            typeof imageConfig.outputCompressionQuality === "number" ? imageConfig.outputCompressionQuality : null,
        }
      : null,
    httpOptions: httpOptions
      ? {
          timeout: typeof httpOptions.timeout === "number" ? httpOptions.timeout : null,
        }
      : null,
  };
};

const summarizeResponseForLog = (response) => {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const first = candidates[0] ?? null;
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const partsSummary = summarizePartsForLog(parts, { maxParts: 8 });

  return {
    candidatesCount: candidates.length,
    finishReason:
      typeof first?.finishReason === "string"
        ? first.finishReason
        : typeof first?.finishReason === "number"
          ? String(first.finishReason)
          : null,
    ...partsSummary,
    promptFeedback: response?.promptFeedback
      ? {
          blockReason:
            typeof response.promptFeedback?.blockReason === "string"
              ? response.promptFeedback.blockReason
              : typeof response.promptFeedback?.blockReason === "number"
                ? String(response.promptFeedback.blockReason)
                : null,
          blockReasonMessage:
            typeof response.promptFeedback?.blockReasonMessage === "string"
              ? response.promptFeedback.blockReasonMessage
              : null,
        }
      : null,
    modelVersion: typeof response?.modelVersion === "string" ? response.modelVersion : null,
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
        return await runner(platform, client, { platformAttempt: i + 1, platformsTotal: count });
      } catch (error) {
        errors.push({ platformId: platform.id, error });
        console.warn(`[gemini] ${operation} attempt failed`, {
          platform: { id: platform.id, baseUrl: platform.baseUrl, model: platform.model },
          error: errorToMessage(error),
        });
      }
    }
    const details = errors.map((e) => `[${e.platformId}] ${errorToMessage(e.error)}`).join(" | ");
    const err = new Error(`${operation} failed on all platforms: ${details}`);
    err.statusCode = 502;
    throw err;
  }

  logRequest(operation, { traceId, platform, params, meta }) {
    console.log(`[gemini] ${operation} request`, {
      traceId: traceId ?? null,
      platform: platform ? { id: platform.id, baseUrl: platform.baseUrl, model: platform.model } : null,
      meta: meta ?? null,
      params: summarizeGenerateContentParamsForLog(params),
    });
  }

  logResponse(operation, { traceId, platform, response, meta, elapsedMs }) {
    console.log(`[gemini] ${operation} response`, {
      traceId: traceId ?? null,
      platform: platform ? { id: platform.id, baseUrl: platform.baseUrl, model: platform.model } : null,
      meta: meta ?? null,
      elapsedMs: typeof elapsedMs === "number" ? elapsedMs : null,
      response: summarizeResponseForLog(response),
    });
  }

  async editImage(request) {
    const traceId = makeTraceId("editImage");
    const images = Array.isArray(request?.images) ? request.images : [];
    const parts = images.map((img) => ({
      inlineData: { data: dataUrlToBase64(img.href), mimeType: img.mimeType },
    }));

    const mask = request?.mask
      ? { inlineData: { data: dataUrlToBase64(request.mask.href), mimeType: request.mask.mimeType } }
      : null;

    const text = { text: String(request?.prompt || "") };
    const promptParts = mask ? [text, ...parts, mask] : [...parts, text];

    const imageConfig = buildImageConfig({ aspectRatio: request?.aspectRatio, imageSize: request?.imageSize });

    const response = await this.runWithFailover("editImage", async (platform, client, ctx) => {
      const startedAt = Date.now();
      const params = {
        model: platform.model,
        contents: [{ role: "user", parts: promptParts }],
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
          ...(imageConfig ? { imageConfig } : {}),
        },
      };
      this.logRequest("editImage", {
        traceId,
        platform,
        params,
        meta: { ...ctx, imagesCount: images.length, hasMask: Boolean(mask) },
      });
      const resp = await client.models.generateContent(params);
      this.logResponse("editImage", {
        traceId,
        platform,
        response: resp,
        meta: { ...ctx, imagesCount: images.length, hasMask: Boolean(mask) },
        elapsedMs: Date.now() - startedAt,
      });
      return resp;
    });

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
    const traceId = makeTraceId("generateImageFromText");
    const desiredCount =
      typeof request?.imageCount === "number" ? Math.max(1, Math.min(4, Math.floor(request.imageCount))) : 1;

    const imageConfig = buildImageConfig({ aspectRatio: request?.aspectRatio, imageSize: request?.imageSize });

    const generatedImages = [];
    for (let i = 0; i < desiredCount; i++) {
      const startPlatformIndex = this.platforms.length ? i % this.platforms.length : 0;
      let usedPlatform = null;
      const response = await this.runWithFailover(
        "generateImageFromText",
        async (platform, client, ctx) => {
          usedPlatform = platform;
          const startedAt = Date.now();
          const params = {
            model: platform.model,
            contents: [{ role: "user", parts: [{ text: String(request?.prompt || "") }] }],
            config: {
              responseModalities: [Modality.TEXT, Modality.IMAGE],
              ...(imageConfig ? { imageConfig } : {}),
            },
          };
          this.logRequest("generateImageFromText", {
            traceId,
            platform,
            params,
            meta: { ...ctx, imageIndex: i + 1, imageCount: desiredCount },
          });
          const resp = await client.models.generateContent(params);
          this.logResponse("generateImageFromText", {
            traceId,
            platform,
            response: resp,
            meta: { ...ctx, imageIndex: i + 1, imageCount: desiredCount },
            elapsedMs: Date.now() - startedAt,
          });
          return resp;
        },
        startPlatformIndex
      );

      const images = pickGeneratedImagesFromResponse(response);
      const first = images[0];
      if (!first) {
        console.warn("[gemini] generateImageFromText: response has no image data", {
          traceId,
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
    const traceId = makeTraceId("probePlatform");
    const client = this.getClient(platform);
    const startedAt = Date.now();
    try {
      const params = {
        model: platform.model,
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        config: {
          responseModalities: [Modality.TEXT],
          httpOptions: { timeout: timeoutMs },
        },
      };
      this.logRequest("probePlatform", { traceId, platform, params, meta: null });
      const resp = await client.models.generateContent(params);
      this.logResponse("probePlatform", {
        traceId,
        platform,
        response: resp,
        meta: null,
        elapsedMs: Date.now() - startedAt,
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

  async probePlatformGenerateImage(platform, timeoutMs = 180000) {
    const traceId = makeTraceId("probePlatformGenerateImage");
    const client = this.getClient(platform);
    const startedAt = Date.now();
    try {
      const imageConfig = buildImageConfig({ imageSize: "1K", aspectRatio: "auto" });
      const params = {
        model: platform.model,
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
          ...(imageConfig ? { imageConfig } : {}),
          httpOptions: { timeout: timeoutMs },
        },
      };
      this.logRequest("probePlatformGenerateImage", { traceId, platform, params, meta: null });
      const response = await client.models.generateContent(params);
      this.logResponse("probePlatformGenerateImage", {
        traceId,
        platform,
        response,
        meta: null,
        elapsedMs: Date.now() - startedAt,
      });

      const images = pickGeneratedImagesFromResponse(response);
      if (!images.length) {
        const err = new Error("Gemini response did not include image data.");
        err.statusCode = 502;
        throw err;
      }

      return { ok: true, latencyMs: Date.now() - startedAt, errorMessage: null };
    } catch (error) {
      const name = typeof error?.name === "string" ? error.name : "";
      const msg = errorToMessage(error);
      const isTimeout = /timeout/i.test(name) || /timed out|timeout/i.test(msg);
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: isTimeout ? `probe timeout after ${timeoutMs}ms` : msg,
      };
    }
  }
}
