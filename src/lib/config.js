const LOCAL_API_BASE_URL = 'http://localhost:8080';

const isLocalHost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

const PRODUCTION_FALLBACK_BASE_URL =
  typeof window !== 'undefined' ? window.location.origin : LOCAL_API_BASE_URL;

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (isLocalHost ? LOCAL_API_BASE_URL : PRODUCTION_FALLBACK_BASE_URL);

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || API_BASE_URL;
