/**
 * login.js — Login page logic (F4: cookie-based auth model).
 * Auth truth is the httpOnly session cookie; no localStorage token usage.
 * Page-load redirect uses GET /api/auth/session.
 * Login submit relies on server-set cookie; no token written to localStorage.
 */
(function () {
  "use strict";

  // ── i18n translations ──────────────────────────────────────────────
  var LOGIN_I18N = {
    "pt-BR": {
      subtitle: "Portal Administrativo",
      email: "E-mail",
      password: "Senha",
      login: "Entrar",
      error_required: "E-mail e senha obrigatórios",
      error_auth: "E-mail ou senha inválidos",
      error_disabled: "Conta desativada",
      error_server: "Erro do servidor — tente novamente",
      error_rate_limit: "Muitas tentativas — tente novamente mais tarde",
    },
    en: {
      subtitle: "Admin Portal",
      email: "Email",
      password: "Password",
      login: "Login",
      error_required: "Email and password are required",
      error_auth: "Invalid email or password",
      error_disabled: "Account is disabled",
      error_server: "Server error — please try again",
      error_rate_limit: "Too many attempts — please try again later",
    },
    "zh-CN": {
      subtitle: "管理平台",
      email: "电子邮件",
      password: "密码",
      login: "登入",
      error_required: "请输入电子邮件和密码",
      error_auth: "电子邮件或密码错误",
      error_disabled: "账户已停用",
      error_server: "服务器错误—请重试",
      error_rate_limit: "尝试次数过多—请稍后重试",
    },
  };

  var currentLang = localStorage.getItem("lang") || "pt-BR";

  function tr(key) {
    var dict = LOGIN_I18N[currentLang] || LOGIN_I18N["pt-BR"];
    return dict[key] || key;
  }

  function updateLabels() {
    document.getElementById("login-subtitle").textContent = tr("subtitle");
    document.getElementById("lbl-email").textContent = tr("email");
    document.getElementById("lbl-password").textContent = tr("password");
    document.getElementById("btn-login").textContent = tr("login");
  }

  // ── F4.1: Auto-redirect if already authenticated (cookie session) ──
  fetch("/api/auth/session", {
    method: "GET",
    credentials: "same-origin",
  })
    .then(function (res) {
      if (res.ok) {
        window.location.href = "index.html";
        return;
      }
      // 401 or other non-ok → show login form
      initLoginForm();
    })
    .catch(function () {
      // Network error → show login form (user can try to log in)
      initLoginForm();
    });

  function initLoginForm() {
    // ── Language switcher ──────────────────────────────────────────────
    var langSwitcher = document.getElementById("lang-switcher");
    langSwitcher.value = currentLang;
    langSwitcher.addEventListener("change", function () {
      currentLang = langSwitcher.value;
      localStorage.setItem("lang", currentLang);
      updateLabels();
    });

    updateLabels();

    // ── Login form handler ─────────────────────────────────────────────
    document
      .getElementById("login-form")
      .addEventListener("submit", function (e) {
        e.preventDefault();
        var email = document.getElementById("input-email").value.trim();
        var password = document.getElementById("input-password").value;
        var errorEl = document.getElementById("error-msg");
        var btnEl = document.getElementById("btn-login");

        if (!email || !password) {
          errorEl.textContent = tr("error_required");
          errorEl.classList.add("visible");
          return;
        }

        errorEl.classList.remove("visible");
        btnEl.disabled = true;
        btnEl.textContent = "...";

        fetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, password: password }),
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { status: res.status, body: data };
            });
          })
          .then(function (result) {
            // F4.3: Handle 429 rate limit
            if (result.status === 429) {
              errorEl.textContent = tr("error_rate_limit");
              errorEl.classList.add("visible");
              return;
            }

            // F4.2: Cookie set by server — no localStorage write needed
            if (result.body.success) {
              window.location.href = "index.html";
            } else {
              var msg = result.body.error || tr("error_auth");
              if (msg === "Account is disabled") msg = tr("error_disabled");
              else if (msg === "Invalid email or password")
                msg = tr("error_auth");
              else if (msg === "Email and password are required")
                msg = tr("error_required");
              errorEl.textContent = msg;
              errorEl.classList.add("visible");
            }
          })
          .catch(function () {
            errorEl.textContent = tr("error_server");
            errorEl.classList.add("visible");
          })
          .finally(function () {
            btnEl.disabled = false;
            btnEl.textContent = tr("login");
          });
      });
  }
})();
