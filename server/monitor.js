import { GeminiRunner } from "./gemini.js";

export class GeminiMonitor {
  constructor({ getPlatforms, probeTimeoutMs }) {
    this.getPlatforms = getPlatforms;
    this.probeTimeoutMs = Number(probeTimeoutMs) || 180000;
    this.statusById = new Map();
    this.timer = null;
  }

  getStatusSnapshot() {
    return Array.from(this.statusById.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async checkOnce() {
    const platforms = await this.getPlatforms();
    const runner = new GeminiRunner({ platforms });

    const nowIso = new Date().toISOString();
    const next = [];

    for (const platform of platforms) {
      const result = await runner.probePlatformGenerateImage(platform, this.probeTimeoutMs);
      const status = {
        id: platform.id,
        baseUrl: platform.baseUrl,
        model: platform.model,
        checkedAt: nowIso,
        ok: result.ok,
        latencyMs: result.latencyMs,
        errorMessage: result.errorMessage,
      };
      this.statusById.set(platform.id, status);
      next.push(status);
    }
    return next;
  }

  start({ intervalMs }) {
    const ms = Math.max(5000, Number(intervalMs) || 60000);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.checkOnce().catch((e) => {
        console.error("[monitor] gemini check failed:", e instanceof Error ? e.message : String(e));
      });
    }, ms);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
