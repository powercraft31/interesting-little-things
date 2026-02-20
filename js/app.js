// ============================================
// SOLFACIL - Main Application Entry Point
// Orchestrates all modules
// ============================================

import {
  loadTranslations,
  setLanguage,
  updateAllTranslations,
  onLanguageChange,
} from "./utils/i18n.js";
import { closeInfoModal } from "./utils/modal.js";
import { setupNavigation, navigateTo } from "./modules/navigation.js";
import {
  initAllCharts,
  updateRevenueCurveChart,
  updateChartLabels,
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
} from "./modules/batch-ops.js";
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

  // Start real-time updates
  startRealTimeUpdates();
}

// Boot the application
document.addEventListener("DOMContentLoaded", init);
