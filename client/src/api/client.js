import axios from 'axios';

const BASE_KEY = 'mp-api-base';
const CSRF_HEADER = 'X-MP-CSRF';
export const DEMO_BASE = '/api/demo';
export const MAIN_BASE = '/api';

// Mirrors csrfCookieName() in server/src/utils/tokens.js: the nonce cookie has
// to live at "/" so the SPA can read it, which means the mount name has to be
// encoded in the cookie name to stop the mounts clobbering each other.
function csrfCookieName(base) {
  const suffix = String(base || '/api')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `mp_csrf_${suffix || 'api'}`;
}

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

// The access token lives only in this module's closure, never in localStorage,
// so an XSS payload cannot read it out of persistent storage. It is short-lived
// (15 min) and re-minted from the httpOnly refresh cookie on boot, so keeping it
// in memory costs nothing but a transparent refresh.
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export function clearAccessToken() {
  accessToken = null;
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const api = axios.create({
  baseURL: getApiBase(),
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Double-submit CSRF: echo the readable nonce cookie in a header for any
  // request that could otherwise be replayed by a cross-site page using our
  // cookies. Must track the active base, so it is re-read per request.
  const csrf = readCookie(csrfCookieName(config.baseURL || getApiBase()));
  if (csrf) {
    config.headers = config.headers || {};
    config.headers[CSRF_HEADER] = csrf;
  }
  return config;
});

let refreshing = null;

// One shared in-flight refresh. Called from the 401 interceptor and from the
// boot session check (AuthContext). Reusing a single promise means concurrent
// callers — e.g. React StrictMode in dev firing the boot effect twice — never
// send two /auth/refresh requests with the same refresh token, which would
// otherwise make the second one fail because the first already rotated it.
export function refreshSession() {
  if (!refreshing) {
    refreshing = api.post('/auth/refresh', null).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.includes('/auth/');

    if (error.response?.status === 401 && !original?._retry && !isAuthCall) {
      original._retry = true;
      try {
        const { data } = await refreshSession();
        setAccessToken(data.accessToken);
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        clearAccessToken();
        if (!['/login', '/setup'].includes(window.location.pathname)) {
          window.location.assign('/login');
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;