// ============================================
// SOLFACIL - Main Application Entry Point
// Orchestrates all modules
// ============================================

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
} from "./modules/batch-ops.js";
import { generateSiteAnalyticsData, getAssetById } from "./modules/data.js";
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
// Application Initialization
// ============================================
async function init() {
  // Load translations first
  await loadTranslations();

  // Apply translations
  updateAllTranslations();

  // Setup components
  setupNavigation();
  setCurrentDate();
  initAllCharts();
  populateAssets();
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

  // Start real-time updates
  startRealTimeUpdates();
}

// Boot the application
document.addEventListener("DOMContentLoaded", init);
