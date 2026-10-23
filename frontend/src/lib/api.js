// =====================================================================
// Backend API-тай харилцах нэг цэг
// =====================================================================
const TOKEN_KEY = 'erp_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Алдаа (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

// form: FormData (файлтай хүсэлт), body: JSON
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token && path !== '/auth/login') {
      setToken(null);
      window.location.href = '/login';
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

// Нэвтэрсэн хэрэглэгчийн token-той татах холбоос (<a href>)
export const authUrl = (apiPath) => `/api${apiPath}${apiPath.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken() ?? '')}`;
export const fileUrl = (storedPath) => authUrl(`/files/${storedPath}`);

// Давхар илгээлтээс хамгаалах түлхүүр (төлбөр)
export function newKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Query string угсрах (хоосон утгыг алгасна)
export function qs(params) {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
}
