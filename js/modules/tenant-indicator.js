// ============================================
// SOLFACIL - Tenant Indicator Module
// Shows current user info in nav bar
// ============================================

import { getCurrentUser, clearToken } from "./auth.js";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const ROLE_BADGES = {
  SOLFACIL_ADMIN: {
    label: "Admin",
    color: "#d97706",
    bg: "rgba(217, 119, 6, 0.15)",
  },
  ORG_MANAGER: {
    label: "Gerente",
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.15)",
  },
  ORG_OPERATOR: {
    label: "Operador",
    color: "#14b8a6",
    bg: "rgba(20, 184, 166, 0.15)",
  },
  ORG_VIEWER: {
    label: "Auditor (Somente Leitura)",
    color: "#94a3b8",
    bg: "rgba(148, 163, 184, 0.15)",
  },
};

/**
 * Initialize the tenant indicator in the header
 */
export function initTenantIndicator() {
  const user = getCurrentUser();
  if (!user) return;

  const badge = ROLE_BADGES[user.role] || {
    label: user.role,
    color: "#64748b",
    bg: "rgba(100,116,139,0.15)",
  };

  const container = document.createElement("div");
  container.className = "tenant-indicator";
  container.innerHTML = `
    <div class="tenant-info">
      <span class="tenant-org">${escapeHtml(user.orgName)}</span>
      <span class="tenant-role-badge" style="background: ${badge.bg}; color: ${badge.color}; border: 1px solid ${badge.color}">
        ${badge.label}
      </span>
    </div>
    <button class="tenant-logout-btn" title="Sair">
      <span class="material-icons">logout</span>
    </button>
  `;

  // Insert into header (before language switcher)
  const headerContainer = document.querySelector(".header-container");
  const langSwitcher = document.querySelector(".language-switcher");
  if (headerContainer && langSwitcher) {
    headerContainer.insertBefore(container, langSwitcher);
  } else if (headerContainer) {
    headerContainer.appendChild(container);
  }

  // Logout handler
  container
    .querySelector(".tenant-logout-btn")
    .addEventListener("click", () => {
      clearToken();
      location.reload();
    });
}
