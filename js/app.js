// ============================================
// SOLFACIL - Main Application Entry Point
// Orchestrates all modules
// ============================================

// Auth & tenant modules
import { isLoggedIn, getCurrentUser, clearToken } from "./modules/auth.js";
import { showLoginModal } from "./modules/login-modal.js";
import { initTenantIndicator } from "./modules/tenant-indicator.js";

import {
  loadTranslations,
  setLanguage,
  updateAllTranslations,
  onLanguageChange,
  t,
} from "./utils/i18n.js";
import { closeInfoModal } from "./utils/modal.js";
import { setupNavigation, navigateTo } from "./modules/navigation.js";
import {
  initAllCharts,
  updateRevenueCurveChart,
  updateChartLabels,
  initDrilldownChart,
  destroyDrilldownChart,
} from "./modules/charts.js";
import {
  populateTrades,
  refreshTrades,
  simulateTradeOpportunity,
  acceptTrade,
  viewDetails,
  rejectTrade,
  setupTradeModal,
} from "./modules/trades.js";
import { setCurrentDate, updateFinancialMetrics } from "./modules/market.js";
import {
  populateAssets,
  refreshAssets,
  initBatchToolbar,
  executeBatchDispatch,
  closeBatchConfirmModal,
  closeProgressModal,
  retryFailedItems,
  startDRTest,
  setDrilldownCallback,
  startHeartbeat,
} from "./modules/batch-ops.js";
import {
  initData,
  generateSiteAnalyticsData,
  getAssetById,
} from "./modules/data.js";
import { setPeriod } from "./modules/reports.js";

// ============================================
// Expose functions to HTML onclick handlers
// ============================================
window.changeLanguage = setLanguage;
window.navigateTo = navigateTo;
window.simulateTradeOpportunity = simulateTradeOpportunity;
window.acceptTrade = acceptTrade;
window.viewDetails = viewDetails;
window.rejectTrade = rejectTrade;
window.executeBatchDispatch = executeBatchDispatch;
window.closeBatchConfirmModal = closeBatchConfirmModal;
window.closeProgressModal = closeProgressModal;
window.retryFailedItems = retryFailedItems;
window.closeInfoModal = closeInfoModal;
window.setPeriod = setPeriod;
window.startDRTest = startDRTest;
window.openDrilldown = openDrilldown;
window.closeDrilldown = closeDrilldown;

// ============================================
// Language Change Handler
// ============================================
onLanguageChange(() => {
  // Refresh dynamic content
  refreshTrades();
  refreshAssets();

  // Update chart labels
  updateChartLabels();

  // Update date display
  setCurrentDate();

  // Update market conditions
  updateFinancialMetrics();
});

// ============================================
// Drilldown Modal
// ============================================
function openDrilldown(assetId) {
  const modal = document.getElementById("assetDrilldownModal");
  if (!modal) return;

  // Get asset name from data store
  const asset = getAssetById(assetId);
  const assetName = asset ? asset.name : assetId;
  document.getElementById("drilldownTitle").textContent = assetName;

  // Generate and display analytics
  const data = generateSiteAnalyticsData(assetId);

  // Update metrics
  document.getElementById("drillMetricPeakDischarge").textContent =
    data.metrics.peakDischarge.toFixed(1) + " kW";
  document.getElementById("drillMetricDailyPV").textContent =
    data.metrics.dailyPV + " kWh";
  document.getElementById("drillMetricSelfSufficiency").textContent =
    data.metrics.selfSufficiency + "%";
  document.getElementById("drillMetricCycles").textContent =
    data.metrics.cycles;

  // Show modal then initialize chart
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  const chartLabels = {
    pvGeneration: t("pv_generation"),
    householdLoad: t("household_load"),
    batteryPower: t("battery_power"),
  };
  setTimeout(() => initDrilldownChart(data, chartLabels), 50);
}

function closeDrilldown() {
  const modal = document.getElementById("assetDrilldownModal");
  if (modal) modal.style.display = "none";
  document.body.style.overflow = "";
  destroyDrilldownChart();
}

// ============================================
// Real-Time Updates
// ============================================
function startRealTimeUpdates() {
  setInterval(() => {
    updateFinancialMetrics();
    updateRevenueCurveChart();
  }, 5000);
}

// ============================================
// Role-Based UI Restrictions
// ============================================
function applyRoleRestrictions() {
  const user = getCurrentUser();
  if (!user || user.role !== "ORG_VIEWER") return;

  // Add read-only banner after nav
  const nav = document.querySelector(".nav");
  if (nav) {
    const banner = document.createElement("div");
    banner.className = "readonly-banner";
    banner.innerHTML = `
      <span class="material-icons">lock</span>
      Somente Leitura &mdash; Modo Auditor
    `;
    nav.insertAdjacentElement("afterend", banner);
  }

  // Disable DR test button
  const drBtn = document.querySelector(".dr-test-btn");
  if (drBtn) drBtn.classList.add("role-disabled");

  // Disable batch dispatch button
  const dispatchBtn = document.querySelector(".batch-dispatch-btn");
  if (dispatchBtn) dispatchBtn.classList.add("role-disabled");

  // Disable mode buttons
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.add("role-disabled");
  });

  // Disable quick action buttons
  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.classList.add("role-disabled");
  });
}

// ============================================
// Application Initialization
// ============================================
async function init() {
  // Auth gate: if not logged in, show login modal and stop
  if (!isLoggedIn()) {
    showLoginModal();
    return;
  }

  // Show tenant info in header
  initTenantIndicator();

  // Load data from BFF (or mock fallback)
  try {
    await initData();
  } catch (err) {
    if (err.status === 401) {
      clearToken();
      showLoginModal();
      return;
    }
    throw err;
  }

  // Load translations first
  await loadTranslations();

  // Apply translations
  updateAllTranslations();

  // Setup components
  setupNavigation();
  setCurrentDate();
  initAllCharts();
  populateAssets();
  startHeartbeat();
  initBatchToolbar();
  populateTrades();
  setupTradeModal();

  // Setup drilldown modal
  setDrilldownCallback(openDrilldown);
  document
    .getElementById("drilldownClose")
    ?.addEventListener("click", closeDrilldown);
  document
    .querySelector(".modal-drilldown-backdrop")
    ?.addEventListener("click", closeDrilldown);

  // Apply role-based restrictions (after all UI is built)
  applyRoleRestrictions();

  // Start real-time updates
  startRealTimeUpdates();
}

// Boot the application
document.addEventListener("DOMContentLoaded", init);
