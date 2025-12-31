type JsonValue = unknown;

const readEnv = (key: string): string | undefined => {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return viteEnv?.[key] ?? processEnv?.[key];
};

const resolveDefaultTimeoutMs = (): number => {
  const raw = readEnv("VITE_BANANAPOD_API_TIMEOUT_MS") ?? readEnv("VITE_API_TIMEOUT_MS");
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return 300_000;
};

const readJson = async (response: Response): Promise<JsonValue> => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, message: text };
  }
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs?: number): Promise<Response> => {
  const ms = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : resolveDefaultTimeoutMs();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
  try {
    return await fetch(url, { ...init, signal: controller?.signal });
  } catch (error: any) {
    const name = typeof error?.name === "string" ? error.name : "";
    if (name === "AbortError") throw new Error(`请求超时（${ms}ms）：${url}`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetchWithTimeout(url, { credentials: "include" });
  const data = await readJson(response);
  if (!response.ok) {
    const message = (data as any)?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(String(message));
  }
  return data as T;
};

export const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await readJson(response);
  if (!response.ok) {
    const message = (data as any)?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(String(message));
  }
  return data as T;
};

export const putJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetchWithTimeout(url, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await readJson(response);
  if (!response.ok) {
    const message = (data as any)?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(String(message));
  }
  return data as T;
};
