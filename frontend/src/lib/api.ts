/** Thin fetch wrapper: same-origin cookies, CSRF header on mutations, typed error envelope. */
export type ApiErrorBody = { code: string; message: string; details?: unknown; requestId?: string };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public requestId?: string) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => { csrfToken = t; };
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

const BASE = '/api/v1';

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !opts.form) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, credentials: 'same-origin', body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) onUnauthorized?.();
  if (!res.ok) {
    let err: ApiErrorBody = { code: 'INTERNAL_ERROR', message: res.statusText };
    try { err = (await res.json()).error ?? err; } catch { /* non-JSON */ }
    throw new ApiError(res.status, err.code, err.message, err.details, err.requestId);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => request<T>('POST', p, undefined, { form }),
};

export function qs(params: Record<string, unknown>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Download a file from an authenticated endpoint (cookie auth) by navigating a hidden link. */
export function downloadUrl(path: string) {
  const a = document.createElement('a');
  a.href = `${BASE}${path}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
export const apiUrl = (p: string) => `${BASE}${p}`;
