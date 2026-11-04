const TOKEN_KEY = 'bimtek_admin_token';

const USER_KEY = 'bimtek_admin_user';

export const adminToken = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch {} },
};

/** Info akun dashboard yang login: { role: 'admin' | 'lo', name, venue?: { id, name } } */
export const adminUser = {
  get: () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  set: (u) => { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {} },
};
export const isLO = () => adminUser.get()?.role === 'lo';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Error ${status}`);
    this.status = status;
    this.data = data || {};
  }
}

// Jumlah permintaan API yang sedang berjalan → dipakai garis progres di atas layar
let pending = 0;
const listeners = new Set();
const setPending = (d) => { pending += d; listeners.forEach((fn) => fn(pending)); };
export const onPendingChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function api(path, opts = {}) {
  setPending(1);
  try { return await request(path, opts); } finally { setPending(-1); }
}

async function request(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers.Authorization = `Bearer ${adminToken.get()}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { error: 'Tidak dapat terhubung ke server. Periksa koneksi internet.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (admin && res.status === 401) {
      adminToken.clear();
      window.location.href = '/admin/login';
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

export const adminUrl = (path) => `/api/admin${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(adminToken.get() || '')}`;
