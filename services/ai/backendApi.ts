type JsonValue = unknown;

const readJson = async (response: Response): Promise<JsonValue> => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, message: text };
  }
};

export const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: "include" });
  const data = await readJson(response);
  if (!response.ok) {
    const message = (data as any)?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(String(message));
  }
  return data as T;
};

export const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
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
  const response = await fetch(url, {
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

