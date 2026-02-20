// ============================================
// SOLFACIL - Authentication Module
// Token management via localStorage
// ============================================

const TOKEN_KEY = "vpp_token";

/**
 * Get parsed token from localStorage
 * @returns {Object|null} TenantContext or null
 */
export function getToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Store tenant context in localStorage
 * @param {Object} tenantContext - { userId, orgId, role, orgName }
 */
export function setToken(tenantContext) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tenantContext));
}

/**
 * Remove token from localStorage
 */
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Check if user is logged in
 * @returns {boolean}
 */
export function isLoggedIn() {
  return getToken() !== null;
}

/**
 * Get current user's TenantContext
 * @returns {Object|null} { userId, orgId, role, orgName }
 */
export function getCurrentUser() {
  return getToken();
}
