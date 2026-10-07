import { ApiError } from "./errors";

type JsonInit = Omit<RequestInit, "body"> & { body?: unknown };

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractError(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return fallback;
}

export async function request<T>(
  input: string,
  init: JsonInit = {},
): Promise<T> {
  const { body, headers, ...rest } = init;
  const isFormData =
    typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(input, {
    ...rest,
    headers: {
      ...(body !== undefined && !isFormData
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : isFormData
          ? (body as FormData)
          : JSON.stringify(body),
  });
  const parsed = await readJson(res);
  if (!res.ok) {
    throw new ApiError(
      extractError(parsed, `Request failed with status ${res.status}`),
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

/**
 * GET that sends `If-None-Match` when a prior validator is known.
 * A 304 returns that prior body and does not parse a payload.
 */
export async function requestConditional<T>(
  input: string,
  prior: { etag: string; body: T } | undefined,
): Promise<{ body: T; etag: string | null }> {
  const res = await fetch(input, {
    headers: prior ? { "If-None-Match": prior.etag } : {},
  });
  if (res.status === 304) {
    if (!prior) {
      throw new ApiError("conditional request returned 304 without a cached body", 304);
    }
    return { body: prior.body, etag: res.headers.get("ETag") ?? prior.etag };
  }
  const parsed = await readJson(res);
  if (!res.ok) {
    throw new ApiError(
      extractError(parsed, `Request failed with status ${res.status}`),
      res.status,
      parsed,
    );
  }
  return { body: parsed as T, etag: res.headers.get("ETag") };
}

/** Fetch a plain-text (or other non-JSON) response body. */
export async function requestText(
  input: string,
  init: RequestInit = {},
): Promise<string> {
  const res = await fetch(input, init);
  const text = await res.text();
  if (!res.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      // keep raw text as body
    }
    throw new ApiError(
      extractError(parsed, `Request failed with status ${res.status}`),
      res.status,
      parsed,
    );
  }
  return text;
}
