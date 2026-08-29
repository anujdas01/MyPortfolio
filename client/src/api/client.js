import axios from 'axios';

const TOKEN_KEY = 'mp-token';
const BASE_KEY = 'mp-api-base';
export const DEMO_BASE = '/api/demo';
export const MAIN_BASE = '/api';

export function getApiBase() {
  return localStorage.getItem(BASE_KEY) || MAIN_BASE;
}

export function setApiBase(base) {
  localStorage.setItem(BASE_KEY, base);
  api.defaults.baseURL = base;
}

export function isDemoSession() {
  return getApiBase() === DEMO_BASE;
}

const api = axios.create({
  baseURL: getApiBase(),
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {}
  return config;
});

let refreshing = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.includes('/auth/');

    if (error.response?.status === 401 && !original?._retry && !isAuthCall) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = api
            .post('/auth/refresh', null)
            .finally(() => {
              refreshing = null;
            });
        }
        const { data } = await refreshing;
        try { localStorage.setItem(TOKEN_KEY, data.accessToken); } catch {}
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        try { localStorage.removeItem(TOKEN_KEY); } catch {}
        if (!['/login', '/setup'].includes(window.location.pathname)) {
          window.location.assign('/login');
        }
      }
    }
    return Promise.reject(error);
  }
);

export { TOKEN_KEY };
export default api;
