export type ImageInput = {
  href: string;
  mimeType: string;
};

export type EditImageRequest = {
  images: ImageInput[];
  prompt: string;
  mask?: ImageInput;
};

export type EditImageResult = {
  newImageBase64: string | null;
  newImageMimeType: string | null;
  textResponse: string | null;
};

export type GenerateImageFromTextRequest = {
  prompt: string;
};

export type GenerateImageFromTextResult = {
  newImageBase64: string | null;
  newImageMimeType: string | null;
  textResponse: string | null;
};

export type GenerateVideoRequest = {
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  onProgress: (message: string) => void;
  image?: ImageInput;
};

export type GenerateVideoResult = {
  videoBlob: Blob;
  mimeType: string;
};

export interface AiService {
  editImage(request: EditImageRequest): Promise<EditImageResult>;
  generateImageFromText(
    request: GenerateImageFromTextRequest
  ): Promise<GenerateImageFromTextResult>;
  generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResult>;
}

