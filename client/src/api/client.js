const API = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const token = localStorage.getItem('melodify_token');
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API}${path}`, { ...options, headers });

    if (res.status === 401) {
      localStorage.removeItem('melodify_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return { success: false, error: 'Session expired' };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      data = { success: false, error: 'Invalid server response' };
    }
    return data;
  } catch (error) {
    return { success: false, error: error.message || 'Network error' };
  }
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: (path) => request(path, { method: 'DELETE' }),
};
