import { GoogleGenAI, Modality } from "@google/genai";

// Gemini 服务端调用封装：
// - 支持多平台（baseUrl/model/apiKey）与失败切换
// - 统一输出请求/响应日志（含 traceId），并可打印 SDK 底层原始 HTTP body（会做脱敏与截断）
// - 统一解析图片 inlineData，供前端展示
const dataUrlToBase64 = (href) => {
  // 前端可能传 data URL（data:<mime>;base64,<data>），服务端仅需要逗号后的 base64 内容。
  const commaIndex = href.indexOf(",");
  return commaIndex >= 0 ? href.slice(commaIndex + 1) : href;
};

// 统一把 Error/未知异常转换成可日志输出的字符串。
const errorToMessage = (error) => (error instanceof Error ? error.message : String(error));

// 日志截断：避免把超长 HTTP Body/文本一次性打爆终端或日志系统。
const truncateText = (text, maxLen) => {
  const s = String(text ?? "");
  if (!Number.isFinite(maxLen) || maxLen <= 0) return { text: s, truncated: false };
  if (s.length <= maxLen) return { text: s, truncated: false };
  return { text: `${s.slice(0, Math.max(0, maxLen - 1))}…`, truncated: true };
};

// 控制“底层原始 HTTP body”日志最大字符数（默认 0=不截断）。
const getHttpBodyLogMaxChars = () => {
  const raw = process.env.BANANAPOD_HTTP_BODY_LOG_MAX_CHARS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// 把文本中的 data URL base64 片段替换为长度占位（保留 mimeType 等前缀便于排查）。
// 示例：data:image/jpeg;base64,xxxxx -> data:image/jpeg;base64,<base64 len=12345>
const redactDataUrlsInText = (text) => {
  const s = String(text ?? "");
  if (!s.includes("data:") || !s.includes(";base64,")) return s;

  let out = "";
  let i = 0;
  while (i < s.length) {
    const dataIndex = s.indexOf("data:", i);
    if (dataIndex < 0) break;

    const base64Index = s.indexOf(";base64,", dataIndex);
    if (base64Index < 0) break;

    const dataStart = base64Index + ";base64,".length;
    let dataEnd = dataStart;
    while (dataEnd < s.length) {
      const ch = s.charCodeAt(dataEnd);
      const isBase64Char =
        (ch >= 48 && ch <= 57) || // 0-9
        (ch >= 65 && ch <= 90) || // A-Z
        (ch >= 97 && ch <= 122) || // a-z
        ch === 43 || // +
        ch === 47 || // /
        ch === 61; // =
      if (!isBase64Char) break;
      dataEnd++;
    }

    out += s.slice(i, dataStart);
    out += `<base64 len=${Math.max(0, dataEnd - dataStart)}>`;
    i = dataEnd;
  }

  out += s.slice(i);
  return out;
};

// 脱敏：把图片/音视频等 inlineData.data 的 base64 替换为长度占位，避免泄露内容且避免日志过大。
const redactJsonForLog = (obj) => {
  const seen = new WeakSet();
  return JSON.parse(
    JSON.stringify(obj, function (key, value) {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      // 有些网关/模型会把图片以 data URL（data:image/...;base64,xxxx）塞进 text 字段里，这里也要脱敏。
      if (key === "text" && typeof value === "string" && value.includes(";base64,")) {
        return redactDataUrlsInText(value);
      }
      if (
        key === "data" &&
        typeof value === "string" &&
        value.length > 80 &&
        this &&
        typeof this === "object" &&
        ("mimeType" in this || "mime_type" in this)
      ) {
        return `<base64 len=${value.length}>`;
      }
      return value;
    })
  );
};

// 读取 SDK 暴露的底层 HTTP Response：用于输出原始 body（注意：有时 body 可能已被 SDK 消费或不可 clone）。
const tryReadResponseInternalBody = async (response) => {
  const http = response?.sdkHttpResponse;
  const internal = http?.responseInternal;
  if (!internal) return null;

  const status = typeof internal?.status === "number" ? internal.status : null;
  const statusText = typeof internal?.statusText === "string" ? internal.statusText : null;

  if (typeof internal?.clone !== "function" || typeof internal?.text !== "function") {
    return { status, statusText, bodyText: null, bodyTextRedacted: null, truncated: false, error: "responseInternal has no clone/text" };
  }

  try {
    const bodyText = await internal.clone().text();
    const maxChars = getHttpBodyLogMaxChars();
    const { text: bodyTextMaybeTruncated, truncated } = truncateText(bodyText, maxChars);

    let bodyTextRedacted = bodyTextMaybeTruncated;
    try {
      const json = JSON.parse(bodyTextMaybeTruncated);
      bodyTextRedacted = JSON.stringify(redactJsonForLog(json), null, 2);
    } catch {
      // 非 JSON（或 JSON 被截断导致无法解析）时，至少对 data URL base64 做一次替换。
      bodyTextRedacted = redactDataUrlsInText(bodyTextMaybeTruncated);
    }

    return {
      status,
      statusText,
      bodyText,
      bodyTextRedacted,
      truncated,
      error: null,
    };
  } catch (e) {
    return {
      status,
      statusText,
      bodyText: null,
      bodyTextRedacted: null,
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

const makeTraceId = (operation) =>
  `${operation}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

// Gemini 的 aspectRatio：'auto' 表示不传，由服务端/模型默认决定。
const normalizeAspectRatio = (value) => {
  const ratio = String(value ?? "").trim();
  if (!ratio || ratio === "auto") return undefined;
  return ratio;
};

// imageSize 直接透传 1K/2K/4K（部分网关/模型要求这个枚举值）；同时也兼容 "1024x1024" 这种格式。
const normalizeImageSize = (value) => {
  const size = String(value ?? "").trim();
  if (!size) return undefined;
  if (/^\d+x\d+$/i.test(size)) return size;
  const map = {
    "1K": "1K",
    "2K": "2K",
    "4K": "4K",
    "1k": "1K",
    "2k": "2K",
    "4k": "4K",
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

const summarizePartsForLog = (parts) => {
  // parts 里可能含有大段 base64（inlineData.data），这里只记录 text（会脱敏 data URL）、inlineData 的 mimeType 与长度等信息。
  const list = Array.isArray(parts) ? parts : [];
  return {
    partsCount: list.length,
    parts: list.map((p) => ({
      hasText: typeof p?.text === "string" && p.text.length > 0,
      textLength: typeof p?.text === "string" ? p.text.length : null,
      text: typeof p?.text === "string" ? redactDataUrlsInText(p.text) : null,
      hasInlineData: Boolean(p?.inlineData?.data && p?.inlineData?.mimeType),
      inlineMimeType: typeof p?.inlineData?.mimeType === "string" ? p.inlineData.mimeType : null,
      inlineDataLength: typeof p?.inlineData?.data === "string" ? p.inlineData.data.length : null,
    })),
  };
};

const summarizeGenerateContentParamsForLog = (params) => {
  // 打印 generateContent 的“请求结构”，图片/音视频 base64 会脱敏（保留长度）。
  const contents = Array.isArray(params?.contents) ? params.contents : [];
  const contentsAll = contents.map((c) => ({
    role: typeof c?.role === "string" ? c.role : null,
    ...summarizePartsForLog(c?.parts),
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
    contents: contentsAll,
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
  // 打印 generateContent 的“响应结构”：候选数、finishReason、parts 信息、promptFeedback 等。
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];

  return {
    candidatesCount: candidates.length,
    candidates: candidates.map((c, idx) => ({
      index: idx,
      finishReason:
        typeof c?.finishReason === "string"
          ? c.finishReason
          : typeof c?.finishReason === "number"
            ? String(c.finishReason)
            : null,
      ...summarizePartsForLog(c?.content?.parts),
    })),
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

// 从文本中提取 data:image/...;base64,...（支持 Markdown ![...](data:...) 这种形式）。
const pickImagesFromText = (text) => {
  const s = String(text ?? "");
  if (!s.includes("data:") || !s.includes(";base64,")) return [];

  const images = [];
  let i = 0;
  while (i < s.length) {
    const dataIndex = s.indexOf("data:", i);
    if (dataIndex < 0) break;

    const base64Index = s.indexOf(";base64,", dataIndex);
    if (base64Index < 0) break;

    const mimeType = s.slice(dataIndex + 5, base64Index).trim();
    const dataStart = base64Index + ";base64,".length;

    let dataEnd = dataStart;
    while (dataEnd < s.length) {
      const ch = s.charCodeAt(dataEnd);
      const isBase64Char =
        (ch >= 48 && ch <= 57) || // 0-9
        (ch >= 65 && ch <= 90) || // A-Z
        (ch >= 97 && ch <= 122) || // a-z
        ch === 43 || // +
        ch === 47 || // /
        ch === 61; // =
      if (!isBase64Char) break;
      dataEnd++;
    }

    if (mimeType.startsWith("image/") && dataEnd > dataStart) {
      images.push({ base64: s.slice(dataStart, dataEnd), mimeType });
    }

    i = dataEnd;
  }

  return images;
};

const pickGeneratedImagesFromResponse = (response) => {
  // 从 candidates[0].content.parts 中提取所有 inlineData 图片（如果模型/网关只返回文本则会为空）。
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const images = [];
  for (const part of parts) {
    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
      images.push({ base64: part.inlineData.data, mimeType: part.inlineData.mimeType });
    }
    // 兼容：有些网关会把图片以 data URL 写进 text（例如：![image](data:image/jpeg;base64,...)）。
    if (typeof part?.text === "string" && part.text.includes(";base64,")) {
      images.push(...pickImagesFromText(part.text));
    }
  }
  return images;
};

export class GeminiRunner {
  constructor({ platforms }) {
    // platforms: [{ id, baseUrl, model, apiKey }]，由 server/config.js 读取/校验后传入。
    this.platforms = Array.isArray(platforms) ? platforms : [];
    // 按平台 id 缓存 SDK client，避免每次请求都重新创建。
    this.clients = new Map();
  }

  getClient(platform) {
    // 每个平台一个 GoogleGenAI client（内部绑定 apiKey 与 baseUrl）。
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
    // 失败切换：同一个 operation 会按 platforms 顺序尝试，全部失败才抛错（并聚合错误信息）。
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
        // 单次失败也打出来，方便定位是哪个平台/网关在报错。
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

  // 统一请求日志：输出“请求摘要”，不会直接打印大段 base64。
  logRequest(operation, { traceId, platform, params, meta }) {
    console.log(`[gemini] ${operation} request`, {
      traceId: traceId ?? null,
      platform: platform ? { id: platform.id, baseUrl: platform.baseUrl, model: platform.model } : null,
      meta: meta ?? null,
      params: summarizeGenerateContentParamsForLog(params),
    });
  }

  // 统一响应日志：先输出“响应摘要”，再尝试输出 SDK 底层 responseInternal 的 HTTP 状态与原始 body（JSON 会脱敏）。
  async logResponse(operation, { traceId, platform, response, meta, elapsedMs }) {
    console.log(`[gemini] ${operation} response`, {
      traceId: traceId ?? null,
      platform: platform ? { id: platform.id, baseUrl: platform.baseUrl, model: platform.model } : null,
      meta: meta ?? null,
      elapsedMs: typeof elapsedMs === "number" ? elapsedMs : null,
      response: summarizeResponseForLog(response),
    });

    const http = await tryReadResponseInternalBody(response);
    if (!http) return;

    console.log(`[gemini] ${operation} http`, {
      traceId: traceId ?? null,
      platform: platform ? { id: platform.id, baseUrl: platform.baseUrl, model: platform.model } : null,
      status: http.status,
      statusText: http.statusText,
      truncated: http.truncated,
      error: http.error,
      bodyLength: typeof http.bodyText === "string" ? http.bodyText.length : null,
      bodyLogMaxChars: getHttpBodyLogMaxChars(),
    });

    if (typeof http.bodyTextRedacted === "string" && http.bodyTextRedacted.length) {
      console.log(
        `--- [gemini] ${operation} http body (redacted) traceId=${traceId} ---\n${http.bodyTextRedacted}\n--- [gemini] http body end ---`
      );
    }
  }

  async editImage(request) {
    // 图生图/编辑：输入 images（可选 mask）+ prompt，输出图片 inlineData。
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
      // 每次请求必须打印：请求摘要 + 响应摘要 + 底层 HTTP body（若可读）。
      this.logRequest("editImage", {
        traceId,
        platform,
        params,
        meta: { ...ctx, imagesCount: images.length, hasMask: Boolean(mask) },
      });
      const resp = await client.models.generateContent(params);
      await this.logResponse("editImage", {
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
    // 文生图：按 imageCount 生成 N 张图。每张图会独立发起一次请求，并支持平台轮询/失败切换。
    const traceId = makeTraceId("generateImageFromText");
    const desiredCount =
      typeof request?.imageCount === "number" ? Math.max(1, Math.min(4, Math.floor(request.imageCount))) : 1;

    const imageConfig = buildImageConfig({ aspectRatio: request?.aspectRatio, imageSize: request?.imageSize });

    const generatedImages = [];
    for (let i = 0; i < desiredCount; i++) {
      // 让多平台尽量均匀分摊：第 i 张图从第 i 个平台开始尝试。
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
          await this.logResponse("generateImageFromText", {
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
        // 常见原因：网关不支持图片、被安全策略拦截、返回仅文本、或返回 candidates 为空。
        console.warn("[gemini] generateImageFromText: response has no image data", {
          traceId,
          platform: usedPlatform
            ? { id: usedPlatform.id, baseUrl: usedPlatform.baseUrl, model: usedPlatform.model }
            : null,
	          request: {
	            promptLength: String(request?.prompt || "").length,
	            prompt: redactDataUrlsInText(String(request?.prompt || "")),
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
    // “平台状态探测”旧逻辑：发一个纯文本 ping（目前 UI 已不使用，但保留以备需要）。
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
      await this.logResponse("probePlatform", {
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
    // “平台状态探测”现逻辑：真实发起一次文生图（1K），以是否返回图片判断 ok。
    // 注意：这会消耗调用额度/计费，请按需使用。
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
      await this.logResponse("probePlatformGenerateImage", {
        traceId,
        platform,
        response,
        meta: null,
        elapsedMs: Date.now() - startedAt,
      });

      const images = pickGeneratedImagesFromResponse(response);
      const candidatesCount = Array.isArray(response?.candidates) ? response.candidates.length : 0;
      const imageCount = images.length;
      if (!imageCount) {
        const errorMessage = "Gemini response did not include image data.";
        console.warn("[gemini] probePlatformGenerateImage failed", {
          traceId,
          platform: { id: platform.id, baseUrl: platform.baseUrl, model: platform.model },
          candidatesCount,
          imageCount,
          error: errorMessage,
        });
        return { ok: false, latencyMs: Date.now() - startedAt, errorMessage, traceId, candidatesCount, imageCount };
      }

      return { ok: true, latencyMs: Date.now() - startedAt, errorMessage: null, traceId, candidatesCount, imageCount };
    } catch (error) {
      const name = typeof error?.name === "string" ? error.name : "";
      const msg = errorToMessage(error);
      const isTimeout = /timeout/i.test(name) || /timed out|timeout/i.test(msg);
      const errorMessage = isTimeout ? `probe timeout after ${timeoutMs}ms` : msg;
      console.warn("[gemini] probePlatformGenerateImage failed", {
        traceId,
        platform: { id: platform.id, baseUrl: platform.baseUrl, model: platform.model },
        error: errorMessage,
      });
      return { ok: false, latencyMs: Date.now() - startedAt, errorMessage, traceId, candidatesCount: 0, imageCount: 0 };
    }
  }
}
