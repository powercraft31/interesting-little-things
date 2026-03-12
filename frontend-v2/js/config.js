// ============================================
// BFF API Configuration (Production)
// ============================================
// Uses relative path so it works on any host behind nginx/reverse proxy.
// ============================================

// eslint-disable-next-line no-unused-vars
const CONFIG = {
  BFF_API_URL: "/api",    // relative path — works via nginx → BFF
  USE_MOCK: false,        // false = fetch from API; true = use hardcoded mock data
};
