/**
 * BananaPod 的 AI Provider 抽象层：用统一的类型与方法屏蔽不同后端（Gemini / NanoBanana 等）的差异。
 *
 * - 上层（UI）只依赖 `AiService`，不关心某个操作内部到底调用了多少个 API（单次请求 / 创建任务+轮询+下载等）。
 * - 约定：图片内容用 base64（不带 `data:` 前缀）在服务层流转；必要时由实现自行做 dataURL/base64 互转。
 */
export type ImageInput = {
  /** 图片来源：通常是 `data:` URL；也可能是可被后端直接访问的 URL（实现方自行兼容）。 */
  href: string;
  /** MIME 类型，例如 `image/png`、`image/jpeg`。 */
  mimeType: string;
};

export type GeneratedImage = {
  /** 生成图片的 base64（不含 `data:image/...;base64,` 前缀）。 */
  base64: string;
  /** 生成图片的 MIME 类型。 */
  mimeType: string;
};

export type EditImageRequest = {
  /**
   * 待编辑的输入图片列表。
   * - 多图输入用于“参考图/组合图”等场景（具体能力由 Provider 决定）。
   */
  images: ImageInput[];
  /** 用户提示词（编辑指令）。 */
  prompt: string;
  /** 可选蒙版（通常与 `images[0]` 尺寸一致；具体规则由 Provider 决定）。 */
  mask?: ImageInput;
  /** 可选宽高比（Provider 可能支持 `auto` / `1:1` / `16:9` 等）。 */
  aspectRatio?: string;
  /** 可选尺寸档位（Provider 可能支持 `1024x1024` / `4K` 等）。 */
  imageSize?: string;
  /** 期望生成的张数（实现方可自行裁剪/限制，例如 1~4）。 */
  imageCount?: number;
};

export type EditImageResult = {
  /**
   * 兼容字段：第一张生成图的 base64（不含前缀）。
   * - 当支持多图返回时，推荐使用 `generatedImages`。
   */
  newImageBase64: string | null;
  /** 兼容字段：第一张生成图的 MIME 类型。 */
  newImageMimeType: string | null;
  /** 可选文本输出（例如模型的解释、被拦截原因等）。 */
  textResponse: string | null;
  /** 可选多图输出；存在时通常包含第一张图。 */
  generatedImages?: GeneratedImage[];
};

export type GenerateImageFromTextRequest = {
  /** 用户提示词（文生图）。 */
  prompt: string;
  /** 可选宽高比（Provider 可能支持 `auto` / `1:1` / `16:9` 等）。 */
  aspectRatio?: string;
  /** 可选尺寸档位（Provider 可能支持 `1024x1024` / `4K` 等）。 */
  imageSize?: string;
  /** 期望生成的张数（实现方可自行裁剪/限制，例如 1~4）。 */
  imageCount?: number;
};

export type GenerateImageFromTextResult = {
  /** 兼容字段：第一张生成图的 base64（不含前缀）。 */
  newImageBase64: string | null;
  /** 兼容字段：第一张生成图的 MIME 类型。 */
  newImageMimeType: string | null;
  /** 可选文本输出（例如失败原因）。 */
  textResponse: string | null;
  /** 可选多图输出；存在时通常包含第一张图。 */
  generatedImages?: GeneratedImage[];
};

export type GenerateVideoRequest = {
  /** 用户提示词（文生视频 / 图生视频）。 */
  prompt: string;
  /** 视频宽高比（当前 UI 只暴露竖/横屏两种）。 */
  aspectRatio: "16:9" | "9:16";
  /**
   * 进度回调：用于长任务（轮询）给 UI “活着的反馈”。
   * - 实现方可在关键阶段/每次轮询时调用；调用频率由实现方决定。
   */
  onProgress: (message: string) => void;
  /** 可选参考图（用于图生视频；具体是否支持由 Provider 决定）。 */
  image?: ImageInput;
};

export type GenerateVideoResult = {
  /** 生成视频的二进制内容（浏览器侧可用于下载/播放）。 */
  videoBlob: Blob;
  /** 视频 MIME 类型，例如 `video/mp4`。 */
  mimeType: string;
};

/** 统一的 AI 能力入口；不同 Provider 内部可用单次请求或多步链路实现。 */
export interface AiService {
  /** 图片编辑（可能内部包含多次 API 调用，例如：创建任务 → 轮询 → 下载）。 */
  editImage(request: EditImageRequest): Promise<EditImageResult>;
  /** 文生图（可能返回多张）。 */
  generateImageFromText(
    request: GenerateImageFromTextRequest
  ): Promise<GenerateImageFromTextResult>;
  /** 生成视频（通常为长任务，需结合 `onProgress` 展示进度）。 */
  generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResult>;
}
