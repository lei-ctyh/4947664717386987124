import type { AiService, GenerateVideoRequest, GenerateVideoResult } from "./aiService";

export type FailoverPlatform<TService> = {
  /** Human-readable id for debugging (avoid secrets). */
  id: string;
  service: TService;
};

const errorToMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const buildAggregateError = (operation: string, errors: Array<{ platformId: string; error: unknown }>): Error => {
  const details = errors.map((e) => `[${e.platformId}] ${errorToMessage(e.error)}`).join(" | ");
  return new Error(`${operation} failed on all platforms: ${details}`);
};

/**
 * Wrap multiple platform-specific `AiService` instances into a single `AiService`.
 *
 * Policy:
 * - Platform is not user-selectable (UI only selects provider/vendor).
 * - If a platform fails for any reason, immediately try the next platform (no retries).
 * - Since task ids are not portable across platforms, each attempt re-runs the full operation.
 */
export const createFailoverAiService = (platforms: Array<FailoverPlatform<AiService>>): AiService => {
  if (!platforms.length) throw new Error("No platforms configured for failover AiService.");
  if (platforms.length === 1) return platforms[0].service;

  return {
    async editImage(request) {
      const errors: Array<{ platformId: string; error: unknown }> = [];
      for (const platform of platforms) {
        try {
          return await platform.service.editImage(request);
        } catch (error) {
          errors.push({ platformId: platform.id, error });
        }
      }
      throw buildAggregateError("editImage", errors);
    },

    async generateImageFromText(request) {
      const errors: Array<{ platformId: string; error: unknown }> = [];
      for (const platform of platforms) {
        try {
          return await platform.service.generateImageFromText(request);
        } catch (error) {
          errors.push({ platformId: platform.id, error });
        }
      }
      throw buildAggregateError("generateImageFromText", errors);
    },

    async generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResult> {
      const errors: Array<{ platformId: string; error: unknown }> = [];
      for (const platform of platforms) {
        try {
          const wrappedRequest: GenerateVideoRequest = {
            ...request,
            onProgress: (message) => request.onProgress(`[${platform.id}] ${message}`),
          };
          return await platform.service.generateVideo(wrappedRequest);
        } catch (error) {
          errors.push({ platformId: platform.id, error });
        }
      }
      throw buildAggregateError("generateVideo", errors);
    },
  };
};

