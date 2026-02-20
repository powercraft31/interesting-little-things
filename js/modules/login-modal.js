// ============================================
// SOLFACIL - Login Modal Module
// Full-screen role-selection login for demo
// ============================================

import { setToken } from "./auth.js";

const DEMO_PROFILES = [
  {
    icon: "\ud83d\udc51",
    label: "Solfacil Admin",
    description: "Acesso total",
    orgId: "SOLFACIL",
    orgName: "SOLFACIL",
    role: "SOLFACIL_ADMIN",
    color: "#d97706",
    bgColor: "rgba(217, 119, 6, 0.15)",
    borderColor: "#d97706",
  },
  {
    icon: "\ud83c\udfe2",
    label: "Energia Solar SP",
    description: "Gerente",
    orgId: "ORG_ENERGIA_001",
    orgName: "Energia Solar SP",
    role: "ORG_MANAGER",
    color: "#3b82f6",
    bgColor: "rgba(59, 130, 246, 0.15)",
    borderColor: "#3b82f6",
  },
  {
    icon: "\ud83d\udd27",
    label: "Energia Solar SP",
    description: "Operador",
    orgId: "ORG_ENERGIA_001",
    orgName: "Energia Solar SP",
    role: "ORG_OPERATOR",
    color: "#14b8a6",
    bgColor: "rgba(20, 184, 166, 0.15)",
    borderColor: "#14b8a6",
  },
  {
    icon: "\ud83d\udc41\ufe0f",
    label: "SolarBR Nordeste",
    description: "Auditor",
    orgId: "ORG_SOLARBR_002",
    orgName: "SolarBR Nordeste",
    role: "ORG_VIEWER",
    color: "#94a3b8",
    bgColor: "rgba(148, 163, 184, 0.15)",
    borderColor: "#94a3b8",
  },
];

function buildRoleBadge(role) {
  const map = {
    SOLFACIL_ADMIN: "Admin",
    ORG_MANAGER: "Gerente",
    ORG_OPERATOR: "Operador",
    ORG_VIEWER: "Somente Leitura",
  };
  return map[role] || role;
}

function createModal() {
  const overlay = document.createElement("div");
  overlay.id = "loginModal";
  overlay.className = "login-modal-overlay";

  const buttons = DEMO_PROFILES.map(
    (p) => `
    <button class="login-role-btn" data-role="${p.role}"
            style="--btn-color: ${p.color}; --btn-bg: ${p.bgColor}; --btn-border: ${p.borderColor}">
      <span class="login-role-icon">${p.icon}</span>
      <div class="login-role-info">
        <span class="login-role-org">${p.label}</span>
        <span class="login-role-badge" style="background: ${p.color}">${buildRoleBadge(p.role)}</span>
      </div>
      <span class="login-role-desc">${p.description}</span>
    </button>
  `,
  ).join("");

  overlay.innerHTML = `
    <div class="login-modal-card">
      <div class="login-modal-header">
        <div class="login-logo">
          <span class="material-icons login-logo-icon">account_balance</span>
          <span class="login-logo-text">SOLFACIL</span>
        </div>
        <p class="login-subtitle">Virtual Power Plant</p>
        <p class="login-prompt">Selecione seu perfil para continuar</p>
      </div>
      <div class="login-roles-grid">
        ${buttons}
      </div>
      <div class="login-footer">
        <span class="material-icons" style="font-size: 14px; vertical-align: middle;">lock</span>
        Ambiente de demonstra\u00e7\u00e3o &mdash; dados simulados
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Attach click handlers
  overlay.querySelectorAll(".login-role-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.dataset.role;
      const profile = DEMO_PROFILES.find((p) => p.role === role);
      if (!profile) return;

      setToken({
        userId: "demo-" + role.toLowerCase(),
        orgId: profile.orgId,
        role: profile.role,
        orgName: profile.orgName,
      });

      location.reload();
    });
  });

  // Trigger entrance animation
  requestAnimationFrame(() => {
    overlay.classList.add("login-modal-visible");
  });
}

/**
 * Show the login modal (creates if not present)
 */
export function showLoginModal() {
  const existing = document.getElementById("loginModal");
  if (existing) {
    existing.classList.remove("login-modal-visible");
    existing.style.display = "flex";
    requestAnimationFrame(() => {
      existing.classList.add("login-modal-visible");
    });
    return;
  }
  createModal();
}

/**
 * Hide the login modal
 */
export function hideLoginModal() {
  const modal = document.getElementById("loginModal");
  if (modal) {
    modal.classList.remove("login-modal-visible");
    setTimeout(() => {
      modal.style.display = "none";
    }, 300);
  }
}
