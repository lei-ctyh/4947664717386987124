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

export type NanoBananaServiceOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = "https://grsai.dakka.com.cn";
const DEFAULT_MODEL = "nano-banana-pro";
const DEFAULT_ASPECT_RATIO = "auto";
const DEFAULT_IMAGE_SIZE = "4K";
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 180000;

const resolveEnvApiKey = (): string | undefined => {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return (
    viteEnv?.VITE_NANO_BANANA_API_KEY ??
    viteEnv?.NANO_BANANA_API_KEY ??
    viteEnv?.VITE_API_KEY ??
    processEnv?.VITE_NANO_BANANA_API_KEY ??
    processEnv?.NANO_BANANA_API_KEY ??
    processEnv?.VITE_API_KEY
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dataUrlToBase64 = (href: string): string => {
  const commaIndex = href.indexOf(",");
  return commaIndex >= 0 ? href.slice(commaIndex + 1) : href;
};

const isDataUrl = (value: string) => value.startsWith("data:");

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

type DrawCreateResponse = {
  code?: number;
  msg?: string;
  id?: string;
  data?: { id?: string };
  result?: { id?: string };
  message?: string;
};

type DrawResultData = {
  id?: string;
  status?: string;
  state?: string;
  progress?: number;
  error?: string;
  failure_reason?: string;
  results?: Array<{ url?: string; content?: string }>;
  urls?: string[];
  url?: string;
  images?: string[];
  result?: { urls?: string[]; url?: string };
  message?: string;
};

type DrawResultResponse = {
  code?: number;
  msg?: string;
  data?: DrawResultData | unknown;
  id?: string;
  status?: string;
  state?: string;
  progress?: number;
  message?: string;
  urls?: string[];
  url?: string;
  result?: { urls?: string[]; url?: string };
};

const pickFirstString = (...values: Array<unknown>): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
};

const pickUrls = (payload: DrawResultResponse): string[] => {
  const dataObj = payload.data && typeof payload.data === "object" ? (payload.data as DrawResultData) : undefined;
  if (dataObj?.results?.length) {
    const urls = dataObj.results
      .map((r) => r?.url)
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (urls.length) return urls;
  }

  const candidates: Array<unknown> = [
    payload.urls,
    payload.result?.urls,
    dataObj?.urls,
    dataObj?.images,
    dataObj?.result?.urls,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const urls = candidate.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (urls.length) return urls;
    }
  }
  const singleUrl = pickFirstString(
    payload.url,
    payload.result?.url,
    dataObj?.url,
    dataObj?.result?.url
  );
  return singleUrl ? [singleUrl] : [];
};

const pickStatus = (payload: DrawResultResponse): string | undefined => {
  const dataObj = payload.data && typeof payload.data === "object" ? (payload.data as DrawResultData) : undefined;
  const status = pickFirstString(
    payload.status,
    payload.state,
    dataObj?.status,
    dataObj?.state
  );
  return status?.toLowerCase();
};

const isDoneStatus = (status?: string, urls?: string[]) => {
  if (urls?.length) return true;
  if (!status) return false;
  return ["success", "succeeded", "done", "completed", "finish", "finished", "ok"].includes(status);
};

const isErrorStatus = (status?: string) => {
  if (!status) return false;
  return ["fail", "failed", "error", "canceled", "cancelled"].includes(status);
};

export class NanoBananaAiService implements AiService {
  private readonly options: NanoBananaServiceOptions;
  private resolvedApiKey: string | null = null;

  constructor(options: NanoBananaServiceOptions = {}) {
    this.options = options;
  }

  private getApiKey(): string {
    if (this.resolvedApiKey) return this.resolvedApiKey;
    const apiKey = this.options.apiKey ?? resolveEnvApiKey();
    if (!apiKey) {
      throw new Error(
        "NanoBanana API key is not set. Provide `apiKey` or set `VITE_NANO_BANANA_API_KEY`/`NANO_BANANA_API_KEY`."
      );
    }
    this.resolvedApiKey = apiKey;
    return apiKey;
  }

  private baseUrl(): string {
    return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "*/*",
      Authorization: `Bearer ${this.getApiKey()}`,
    };
  }

  private async createDrawTask(
    urls: string[],
    prompt: string,
    overrides?: { aspectRatio?: string; imageSize?: string; imageCount?: number }
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl()}/v1/draw/nano-banana`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.options.model ?? DEFAULT_MODEL,
        prompt,
        aspectRatio: overrides?.aspectRatio ?? this.options.aspectRatio ?? DEFAULT_ASPECT_RATIO,
        imageSize: overrides?.imageSize ?? this.options.imageSize ?? DEFAULT_IMAGE_SIZE,
        ...(typeof overrides?.imageCount === "number" && overrides.imageCount > 1
          ? { num: Math.max(1, Math.min(4, Math.floor(overrides.imageCount))) }
          : {}),
        urls,
        webHook: "-1",
        shutProgress: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`NanoBanana create task failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as DrawCreateResponse;
    if (typeof json.code === "number" && json.code !== 0) {
      throw new Error(`NanoBanana create task failed: ${json.msg ?? json.message ?? `code=${json.code}`}`);
    }
    const id = pickFirstString(json.id, json.data?.id, json.result?.id);
    if (!id) throw new Error(`NanoBanana create task did not return id: ${JSON.stringify(json)}`);
    return id;
  }

  private async pollDrawResult(
    id: string,
    onProgress?: (message: string) => void
  ): Promise<{ urls: string[]; status?: string; message?: string }> {
    const pollIntervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const response = await fetch(`${this.baseUrl()}/v1/draw/result`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        throw new Error(`NanoBanana fetch result failed: ${response.status} ${response.statusText}`);
      }

      const json = (await response.json()) as DrawResultResponse;
      if (typeof json.code === "number" && json.code !== 0) {
        throw new Error(`NanoBanana task failed: ${json.msg ?? json.message ?? `code=${json.code}`}`);
      }
      const urls = pickUrls(json);
      const status = pickStatus(json);
      const dataObj = json.data && typeof json.data === "object" ? (json.data as DrawResultData) : undefined;
      const message = pickFirstString(json.msg, json.message, dataObj?.message, dataObj?.error, dataObj?.failure_reason);

      if (isDoneStatus(status, urls)) return { urls, status, message };

      if (isErrorStatus(status) && !urls.length) {
        throw new Error(`NanoBanana task failed: ${message ?? status ?? "unknown error"}`);
      }

      if (onProgress) {
        const progress =
          typeof json.progress === "number"
            ? json.progress
            : dataObj && typeof dataObj.progress === "number"
              ? dataObj.progress
              : undefined;
        onProgress(progress != null ? `Generating... (${Math.round(progress * 100)}%)` : "Generating...");
      }

      await sleep(pollIntervalMs);
    }

    throw new Error("NanoBanana task timed out while waiting for result.");
  }

  private async urlToBase64(url: string): Promise<{ base64: string; mimeType: string | null }> {
    if (isDataUrl(url)) {
      const match = /^data:([^;,]+)?(;base64)?,/i.exec(url);
      const mimeType = match?.[1] ?? null;
      return { base64: dataUrlToBase64(url), mimeType };
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download generated image: ${response.status} ${response.statusText}`);
    const blob = await response.blob();
    const mimeType = response.headers.get("Content-Type") ?? blob.type ?? null;
    const base64 = await blobToBase64(blob);
    return { base64, mimeType };
  }

  async editImage(request: EditImageRequest): Promise<EditImageResult> {
    const urls: string[] = request.images.map((img) => img.href);
    if (request.mask) urls.push(request.mask.href);

    const taskId = await this.createDrawTask(urls, request.prompt, {
      aspectRatio: request.aspectRatio,
      imageSize: request.imageSize,
      imageCount: request.imageCount,
    });
    const result = await this.pollDrawResult(taskId);

    const desiredCount =
      typeof request.imageCount === "number" ? Math.max(1, Math.min(4, Math.floor(request.imageCount))) : 1;
    const urlsToFetch = result.urls.slice(0, desiredCount);
    if (!urlsToFetch.length) {
      return { newImageBase64: null, newImageMimeType: null, textResponse: result.message ?? "No image returned." };
    }

    const generatedImages: GeneratedImage[] = [];
    for (const url of urlsToFetch) {
      const { base64, mimeType } = await this.urlToBase64(url);
      generatedImages.push({ base64, mimeType: mimeType ?? "image/png" });
    }
    const first = generatedImages[0];
    return {
      newImageBase64: first?.base64 ?? null,
      newImageMimeType: first?.mimeType ?? null,
      textResponse: null,
      generatedImages,
    };
  }

  async generateImageFromText(request: GenerateImageFromTextRequest): Promise<GenerateImageFromTextResult> {
    const taskId = await this.createDrawTask([], request.prompt, {
      aspectRatio: request.aspectRatio,
      imageSize: request.imageSize,
      imageCount: request.imageCount,
    });
    const result = await this.pollDrawResult(taskId);

    const desiredCount =
      typeof request.imageCount === "number" ? Math.max(1, Math.min(4, Math.floor(request.imageCount))) : 1;
    const urlsToFetch = result.urls.slice(0, desiredCount);
    if (!urlsToFetch.length) {
      return { newImageBase64: null, newImageMimeType: null, textResponse: result.message ?? "No image returned." };
    }

    const generatedImages: GeneratedImage[] = [];
    for (const url of urlsToFetch) {
      const { base64, mimeType } = await this.urlToBase64(url);
      generatedImages.push({ base64, mimeType: mimeType ?? "image/png" });
    }
    const first = generatedImages[0];
    return {
      newImageBase64: first?.base64 ?? null,
      newImageMimeType: first?.mimeType ?? null,
      textResponse: null,
      generatedImages,
    };
  }

  async generateVideo(_request: GenerateVideoRequest): Promise<GenerateVideoResult> {
    throw new Error("NanoBanana video generation is not implemented yet.");
  }
}

export const createNanoBananaAiService = (options: NanoBananaServiceOptions = {}): AiService =>
  new NanoBananaAiService(options);

const defaultNanoBananaService = createNanoBananaAiService();

export async function editImage(images: ImageInput[], prompt: string, mask?: ImageInput): Promise<EditImageResult> {
  return defaultNanoBananaService.editImage({ images, prompt, mask });
}

export async function generateImageFromText(prompt: string): Promise<GenerateImageFromTextResult> {
  return defaultNanoBananaService.generateImageFromText({ prompt });
}
