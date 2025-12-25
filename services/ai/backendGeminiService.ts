import type {
  AiService,
  EditImageRequest,
  EditImageResult,
  GenerateImageFromTextRequest,
  GenerateImageFromTextResult,
  GenerateVideoRequest,
  GenerateVideoResult,
  ImageInput,
} from "./aiService";
import { postJson } from "./backendApi";

const toDataUrlInput = (img: ImageInput) => ({ href: img.href, mimeType: img.mimeType });

type ApiOk<T> = { ok: true; result: T };

export class BackendGeminiAiService implements AiService {
  async editImage(request: EditImageRequest): Promise<EditImageResult> {
    const payload = {
      ...request,
      images: request.images.map(toDataUrlInput),
      ...(request.mask ? { mask: toDataUrlInput(request.mask) } : {}),
    };
    const res = await postJson<ApiOk<EditImageResult>>("/api/ai/gemini/edit-image", payload);
    return res.result;
  }

  async generateImageFromText(request: GenerateImageFromTextRequest): Promise<GenerateImageFromTextResult> {
    const res = await postJson<ApiOk<GenerateImageFromTextResult>>("/api/ai/gemini/generate-image", request);
    return res.result;
  }

  async generateVideo(_request: GenerateVideoRequest): Promise<GenerateVideoResult> {
    throw new Error("视频生成未接入后端。");
  }
}

