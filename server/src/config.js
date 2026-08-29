export const PORT = Number(process.env.PORT || 3001);
export const HOST = process.env.HOST || '127.0.0.1';

const defaultOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
export const CLIENT_ORIGINS = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : defaultOrigins;

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_DAYS = 30;

export const ALLOWED_THEMES = ['light', 'sepia', 'dark', 'github', 'dracula', 'catppuccin', 'gruvbox', 'nord', 'solarized', 'rosepine', 'contrast'];
