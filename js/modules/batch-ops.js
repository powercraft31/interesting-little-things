// ============================================
// SOLFACIL - Batch Operations Module
// Asset selection, mode dispatch, progress tracking
// ============================================

import { t } from "../utils/i18n.js";
import { showInfoModal, setupBackdropClose } from "../utils/modal.js";
import {
  getAssets,
  getAssetCount,
  getAssetsToChange,
  updateAssetMode,
  OPERATION_MODES,
} from "./data.js";

// ============================================
// Batch State (module-scoped, not global)
// ============================================
const batchState = {
  selectedAssets: new Set(),
  targetMode: null,
  isDispatching: false,
  isDRTest: false,
  dispatchResults: [],
};

// Drilldown callback (set by app.js)
let drilldownCallback = null;

export function setDrilldownCallback(fn) {
  drilldownCallback = fn;
}

// ============================================
// Populate Asset Cards
// ============================================
export function populateAssets() {
  const grid = document.getElementById("assetsGrid");
  if (!grid) return;

  const assets = getAssets();

  assets.forEach((asset) => {
    const card = document.createElement("div");
    card.className = "site-card";
    card.setAttribute("data-asset-id", asset.id);

    const isOnline =
      asset.operationalStatus === "operando" || asset.status?.is_online;
    const statusClass = isOnline ? "status-online" : "status-charging";
    const statusText = isOnline ? t("sell_operation") : t("charging");
    const statusIcon = isOnline ? "trending_up" : "battery_charging_full";

    const modeConfig = OPERATION_MODES[asset.operationMode];
    const isSelected = batchState.selectedAssets.has(asset.id);

    if (isSelected) {
      card.classList.add("selected");
    }

    // ── 讀取 metering & status 數據 ──
    const m = asset.metering || {};
    const s = asset.status || {};

    const pvPower = m.pv_power ?? 0;
    const batPower = Math.abs(m.battery_power ?? 0);
    const loadPower = m.load_power ?? 0;
    const gridPower = Math.abs(m.grid_power_kw ?? 0);

    // 電網方向：grid_power_kw > 0 = 進口(importing)，< 0 = 出口(exporting)，= 0 = neutral
    const gridClass =
      (m.grid_power_kw ?? 0) > 0
        ? "importing"
        : (m.grid_power_kw ?? 0) < 0
          ? "exporting"
          : "";
    const gridLabel =
      gridClass === "importing"
        ? "▲ 買電"
        : gridClass === "exporting"
          ? "▼ 賣電"
          : "≈ 0";

    // 電池方向：用 bat_work_status 作為權威來源
    const batStatus = s.bat_work_status ?? "idle";
    const batClass =
      batStatus === "charging"
        ? "charging"
        : batStatus === "discharging"
          ? "discharging"
          : "";
    const batLabel =
      batClass === "charging"
        ? "⬆ 充電"
        : batClass === "discharging"
          ? "⬇ 放電"
          : "─ 待機";

    // SOC
    const soc = s.battery_soc ?? 0;
    const socBarClass =
      soc > 40 ? "soc-high" : soc > 20 ? "soc-medium" : "soc-low";

    // 財務（原有欄位）
    const lucroHoje = asset.lucroHoje ?? 0;
    const roi = asset.roi ?? 0;
    const investimento = asset.investimento ?? 0;
    const payback = asset.payback ?? "-";
    const unidades = asset.unidades ?? 0;
    const pvDaily = m.pv_daily_energy ?? 0;

    card.innerHTML = `
            <div class="site-header">
                <div class="site-name">
                    <label class="asset-checkbox-wrapper" onclick="event.stopPropagation()">
                        <input type="checkbox"
                               class="asset-checkbox"
                               data-asset-id="${asset.id}"
                               ${isSelected ? "checked" : ""}>
                        <span class="asset-checkmark"></span>
                    </label>
                    <span class="material-icons asset-region-icon">location_on</span>
                    ${asset.name}
                </div>
                <div class="site-status ${statusClass}">
                    <span class="material-icons tiny-icon">${statusIcon}</span> ${statusText}
                </div>
            </div>
            <div class="asset-mode-badge"
                 style="background:${modeConfig.bgColor};color:${modeConfig.color};border:1px solid ${modeConfig.borderColor}">
                <span class="material-icons tiny-icon">${modeConfig.icon}</span>
                ${t("current_mode")}: ${t("mode_" + asset.operationMode)}
            </div>
            <div class="energy-flow-panel">
              <div class="energy-flow-diamond">

                <!-- PV (top) -->
                <div class="ef-node ef-pv">
                  <span class="ef-node-icon">\u2600\uFE0F</span>
                  <span class="ef-node-label">光伏</span>
                  <span class="ef-node-value">${pvPower.toFixed(1)} kW</span>
                  <span class="ef-node-sub">日發 ${pvDaily.toFixed(1)} kWh</span>
                </div>

                <!-- Battery (left) -->
                <div class="ef-node ef-battery ${batClass}">
                  <span class="ef-node-icon">\uD83D\uDD0B</span>
                  <span class="ef-node-label">儲能</span>
                  <span class="ef-node-value">${batPower.toFixed(1)} kW</span>
                  <span class="ef-node-sub">${batLabel}</span>
                </div>

                <!-- Center hub -->
                <div class="ef-center">
                  <div class="ef-center-hub"></div>
                </div>

                <!-- Load (right) -->
                <div class="ef-node ef-load">
                  <span class="ef-node-icon">\uD83C\uDFE0</span>
                  <span class="ef-node-label">負載</span>
                  <span class="ef-node-value">${loadPower.toFixed(1)} kW</span>
                </div>

                <!-- Grid (bottom) -->
                <div class="ef-node ef-grid ${gridClass}">
                  <span class="ef-node-icon">\u26A1</span>
                  <span class="ef-node-label">電網</span>
                  <span class="ef-node-value">${gridPower.toFixed(1)} kW</span>
                  <span class="ef-node-sub">${gridLabel}</span>
                </div>

              </div>
            </div>

            <!-- Device Health Row -->
            <div class="device-health-row">
              <div class="health-metric">
                <span class="health-metric-label">SOC</span>
                <div class="soc-bar-wrapper">
                  <div class="soc-bar-fill ${socBarClass}" style="width: ${soc}%"></div>
                </div>
                <span class="health-metric-value ${soc > 40 ? "good" : soc > 20 ? "caution" : "warning"}">${soc}%</span>
              </div>
              <div class="health-metric">
                <span class="health-metric-label">SOH</span>
                <span class="health-metric-value ${(s.bat_soh ?? 100) > 80 ? "good" : "caution"}">${s.bat_soh ?? "-"}%</span>
              </div>
              <div class="health-metric">
                <span class="health-metric-label">溫度</span>
                <span class="health-metric-value ${(s.inverter_temp ?? 0) > 50 ? "warning" : "good"}">${s.inverter_temp ?? "-"}\u00B0C</span>
              </div>
              <div class="health-metric">
                <span class="health-metric-label">循環</span>
                <span class="health-metric-value">${s.bat_cycle_count ?? "-"}</span>
              </div>
            </div>

            <!-- Financial Collapsible -->
            <div class="financial-collapsible" id="fin-${asset.id}">
              <button class="financial-toggle" onclick="window.toggleFinancialDetails('fin-${asset.id}')">
                <span>財務數據</span>
                <span class="material-icons financial-toggle-icon">expand_more</span>
              </button>
              <div class="financial-details">
                <div class="financial-details-inner">
                  <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">payments</span> 今日利潤</span>
                    <span class="metric-value profit-text">R$ ${lucroHoje.toLocaleString("pt-BR")}</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">trending_up</span> 月 ROI</span>
                    <span class="metric-value">${roi}%</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">savings</span> 投資額</span>
                    <span class="metric-value">R$ ${(investimento / 1000000).toFixed(1)}M</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">update</span> 回收期</span>
                    <span class="metric-value">${payback} 年</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">devices</span> 用戶數</span>
                    <span class="metric-value">${unidades.toLocaleString("pt-BR")}</span>
                  </div>
                </div>
              </div>
            </div>
        `;

    // Checkbox change handler
    const checkbox = card.querySelector(".asset-checkbox");
    checkbox.addEventListener("change", () => {
      toggleAssetSelection(asset.id);
    });

    // Card click: drilldown when no batch selection active, otherwise toggle selection
    card.addEventListener("click", (e) => {
      if (!e.target.closest(".asset-checkbox-wrapper")) {
        if (
          batchState.selectedAssets.size === 0 &&
          (drilldownCallback || window.openDrilldown)
        ) {
          const fn = drilldownCallback || window.openDrilldown;
          fn(asset.id);
        } else {
          toggleAssetSelection(asset.id);
        }
      }
    });

    grid.appendChild(card);
  });
}

export function refreshAssets() {
  const grid = document.getElementById("assetsGrid");
  if (grid) {
    grid.innerHTML = "";
    populateAssets();
  }
}

// ============================================
// Batch Toolbar Initialization
// ============================================
export function initBatchToolbar() {
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  const batchResetBtn = document.getElementById("batchResetBtn");
  const batchDispatchBtn = document.getElementById("batchDispatchBtn");
  const modeBtnGroup = document.getElementById("modeBtnGroup");

  if (!selectAllCheckbox) return;

  // Select All checkbox
  selectAllCheckbox.addEventListener("change", () => {
    toggleSelectAll();
  });

  // Select All label click
  const batchLabel = document.querySelector(".batch-label");
  if (batchLabel) {
    batchLabel.addEventListener("click", () => {
      selectAllCheckbox.checked = !selectAllCheckbox.checked;
      toggleSelectAll();
    });
  }

  // Reset button
  batchResetBtn.addEventListener("click", () => {
    resetBatchSelection();
  });

  // Mode buttons
  modeBtnGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (btn) {
      selectMode(btn.getAttribute("data-mode"));
    }
  });

  // Dispatch button
  batchDispatchBtn.addEventListener("click", () => {
    startBatchDispatch();
  });

  // DR Test button
  const drTestBtn = document.getElementById("drTestBtn");
  if (drTestBtn) {
    drTestBtn.addEventListener("click", () => {
      startDRTest();
    });
  }

  // Update total count
  document.getElementById("totalCount").textContent = getAssetCount();

  // Setup modal backdrop close
  setupBackdropClose("batchConfirmModal", closeBatchConfirmModal);

  // Progress modal: only close when not dispatching
  const progressModal = document.getElementById("batchProgressModal");
  if (progressModal) {
    progressModal.addEventListener("click", (e) => {
      if (e.target === progressModal && !batchState.isDispatching) {
        closeProgressModal();
      }
    });
  }
}

// ============================================
// Selection Logic
// ============================================
function toggleAssetSelection(assetId) {
  if (batchState.isDispatching) return;

  if (batchState.selectedAssets.has(assetId)) {
    batchState.selectedAssets.delete(assetId);
  } else {
    batchState.selectedAssets.add(assetId);
  }
  updateBatchUI();
}

function toggleSelectAll() {
  if (batchState.isDispatching) return;

  const assets = getAssets();
  const allIds = assets.map((a) => a.id);
  if (batchState.selectedAssets.size === allIds.length) {
    batchState.selectedAssets.clear();
  } else {
    allIds.forEach((id) => batchState.selectedAssets.add(id));
  }
  updateBatchUI();
}

function updateBatchUI() {
  const count = batchState.selectedAssets.size;
  const total = getAssetCount();

  // Update count display
  document.getElementById("selectedCount").textContent = count;

  // Update select-all checkbox state
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  const checkmark = selectAllCheckbox.nextElementSibling;
  if (count === 0) {
    selectAllCheckbox.checked = false;
    checkmark.classList.remove("indeterminate");
  } else if (count === total) {
    selectAllCheckbox.checked = true;
    checkmark.classList.remove("indeterminate");
  } else {
    selectAllCheckbox.checked = false;
    checkmark.classList.add("indeterminate");
  }

  // Update reset button
  document.getElementById("batchResetBtn").disabled =
    count === 0 && !batchState.targetMode;

  // Update dispatch button
  document.getElementById("batchDispatchBtn").disabled =
    count === 0 || !batchState.targetMode;

  // Update toolbar border
  const toolbar = document.getElementById("batchToolbar");
  toolbar.classList.toggle("has-selection", count > 0);

  // Update card checkboxes and selection highlight
  const assets = getAssets();
  assets.forEach((asset) => {
    const card = document.querySelector(
      `.site-card[data-asset-id="${asset.id}"]`,
    );
    if (!card) return;
    const checkbox = card.querySelector(".asset-checkbox");
    const isSelected = batchState.selectedAssets.has(asset.id);
    if (checkbox) checkbox.checked = isSelected;
    card.classList.toggle("selected", isSelected);
  });
}

function selectMode(mode) {
  if (batchState.isDispatching) return;

  batchState.targetMode = mode;

  // Update mode buttons
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
  });

  updateBatchUI();
}

function resetBatchSelection() {
  batchState.selectedAssets.clear();
  batchState.targetMode = null;

  // Reset mode buttons
  document
    .querySelectorAll(".mode-btn")
    .forEach((btn) => btn.classList.remove("active"));

  updateBatchUI();
}

// ============================================
// Dispatch Flow
// ============================================
function startBatchDispatch() {
  if (batchState.selectedAssets.size === 0 || !batchState.targetMode) return;

  const assetsToChange = getAssetsToChange(
    batchState.selectedAssets,
    batchState.targetMode,
  );
  if (assetsToChange.length === 0) {
    showInfoModal(t("batch_dispatch"), t("all_in_target_mode"), {
      icon: "info",
    });
    return;
  }

  showConfirmModal(assetsToChange);
}

function showConfirmModal(assetsToChange) {
  const list = document.getElementById("batchChangeList");
  const impact = document.getElementById("batchImpactBox");

  let totalUnits = 0;
  list.innerHTML = assetsToChange
    .map((asset) => {
      totalUnits += asset.unidades;
      const fromMode = t("mode_" + asset.operationMode);
      const toMode = t("mode_" + batchState.targetMode);
      return `
            <div class="batch-change-item">
                <span class="material-icons">location_on</span>
                <strong>${asset.name}</strong>
                <span>${fromMode}</span>
                <span class="material-icons batch-change-arrow">arrow_forward</span>
                <span>${toMode}</span>
            </div>
        `;
    })
    .join("");

  impact.innerHTML = `
        <span class="material-icons">warning</span>
        <span>${t("batch_impact_warning")}</span>
        <span style="margin-left:auto; font-weight:700;">
            ${assetsToChange.length} ${t("affected_sites")} / ${totalUnits.toLocaleString("pt-BR")} ${t("affected_units")}
        </span>
    `;

  document.getElementById("batchConfirmModal").classList.add("show");
}

function closeBatchConfirmModal() {
  document.getElementById("batchConfirmModal").classList.remove("show");
}

// Exposed for onclick in HTML
export { closeBatchConfirmModal };

export async function executeBatchDispatch() {
  // Close confirm modal
  document.getElementById("batchConfirmModal").classList.remove("show");

  // Show progress modal
  const progressModal = document.getElementById("batchProgressModal");
  progressModal.classList.add("show");

  batchState.isDispatching = true;
  batchState.dispatchResults = [];

  // DR Test uses all selected assets; normal dispatch only uses assets needing change
  const assetsToChange = batchState.isDRTest
    ? getAssets().filter((a) => batchState.selectedAssets.has(a.id))
    : getAssetsToChange(batchState.selectedAssets, batchState.targetMode);

  // Reset progress UI
  document.getElementById("progressIcon").textContent = "sync";
  document.getElementById("progressIcon").className =
    "material-icons modal-icon spinning";
  document.getElementById("progressTitle").textContent = t("batch_dispatching");
  document.getElementById("closeProgressBtn").disabled = true;
  document.getElementById("retryBtn").style.display = "none";
  document.getElementById("overallProgressText").textContent =
    `0 / ${assetsToChange.length}`;
  document.getElementById("overallProgressFill").style.width = "0%";

  // Render progress list
  const progressList = document.getElementById("dispatchProgressList");
  progressList.innerHTML = assetsToChange
    .map((asset) => {
      const toMode = t("mode_" + batchState.targetMode);
      return `
            <div class="dispatch-progress-item" data-progress-asset="${asset.id}">
                <span class="material-icons progress-status-icon status-waiting">hourglass_empty</span>
                <div class="dispatch-item-info">
                    <div class="dispatch-item-name">${asset.name}</div>
                    <div class="dispatch-item-detail">${toMode} (${asset.unidades} ${t("affected_units")})</div>
                </div>
                <div class="dispatch-item-progress">
                    <div class="progress-bar">
                        <div class="progress-fill dispatch-progress-fill" style="width:0%"></div>
                    </div>
                </div>
                <span class="progress-status-text">${t("dispatch_waiting")}</span>
            </div>
        `;
    })
    .join("");

  // Execute sequentially
  for (let i = 0; i < assetsToChange.length; i++) {
    const asset = assetsToChange[i];
    updateDispatchProgress(asset.id, "executing", 0);

    const result = await simulateAssetModeChange(asset, batchState.targetMode);
    batchState.dispatchResults.push(result);

    updateDispatchProgress(
      asset.id,
      result.success ? "success" : "failed",
      100,
      result,
    );

    if (result.success) {
      updateAssetMode(asset.id, batchState.targetMode);
    }

    // Update overall progress
    updateOverallProgress(assetsToChange.length);
  }

  batchState.isDispatching = false;

  // Show result
  showDispatchResult(batchState.dispatchResults);

  // Refresh asset cards
  refreshAssets();
  updateBatchUI();
}

function simulateAssetModeChange(asset, newMode) {
  return new Promise((resolve) => {
    const duration = 2000 + Math.random() * 2000;
    const steps = 10;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const progress = Math.round((currentStep / steps) * 100);
      updateDispatchProgress(asset.id, "executing", progress);

      if (currentStep >= steps) {
        clearInterval(interval);
        const success = Math.random() > 0.1; // 90% success rate
        const requestedPower = 5.0;
        const actualPower = parseFloat(
          (5.0 * (0.88 + Math.random() * 0.12)).toFixed(2),
        );
        resolve({
          assetId: asset.id,
          assetName: asset.name,
          fromMode: asset.operationMode,
          toMode: newMode,
          success,
          error: success ? null : "communication_timeout",
          units: asset.unidades,
          timestamp: new Date().toISOString(),
          responseLatency: parseFloat((1.5 + Math.random() * 3.5).toFixed(2)),
          requestedPower,
          actualPower,
          get accuracy() {
            return parseFloat(
              ((this.actualPower / this.requestedPower) * 100).toFixed(1),
            );
          },
        });
      }
    }, duration / steps);
  });
}

function updateDispatchProgress(assetId, status, progress, result) {
  const item = document.querySelector(`[data-progress-asset="${assetId}"]`);
  if (!item) return;

  const statusIcon = item.querySelector(".progress-status-icon");
  const progressBar = item.querySelector(".dispatch-progress-fill");
  const statusText = item.querySelector(".progress-status-text");

  if (status === "executing") {
    statusIcon.textContent = "sync";
    statusIcon.className = "material-icons progress-status-icon spinning";
    statusText.textContent = `${progress}%`;
    item.className = "dispatch-progress-item";
  } else if (status === "success") {
    statusIcon.textContent = "check_circle";
    statusIcon.className = "material-icons progress-status-icon status-success";
    statusText.textContent = t("dispatch_success");
    item.className = "dispatch-progress-item success";
  } else if (status === "failed") {
    statusIcon.textContent = "error";
    statusIcon.className = "material-icons progress-status-icon status-failed";
    statusText.textContent = t("dispatch_failed");
    item.className = "dispatch-progress-item failed";
  } else if (status === "waiting") {
    statusIcon.textContent = "hourglass_empty";
    statusIcon.className = "material-icons progress-status-icon status-waiting";
    statusText.textContent = t("dispatch_waiting");
  }

  if (progressBar) {
    progressBar.style.width = `${progress}%`;
  }

  // Render DR metrics when DR Test completes successfully
  if (status === "success" && batchState.isDRTest && result) {
    const metricsDiv = document.createElement("div");
    metricsDiv.className = "dispatch-dr-metrics";
    metricsDiv.innerHTML = `
      <div class="dr-metric"><span>${t("response_latency")}</span><strong>${result.responseLatency}s</strong></div>
      <div class="dr-metric"><span>${t("actual_power")}</span><strong>${result.actualPower}kW</strong></div>
      <div class="dr-metric"><span>${t("accuracy")}</span><strong>${result.accuracy}%</strong></div>
    `;
    item.appendChild(metricsDiv);
  }
}

function updateOverallProgress(total) {
  const completed = batchState.dispatchResults.length;
  const overallBar = document.getElementById("overallProgressFill");
  const overallText = document.getElementById("overallProgressText");

  if (overallBar) overallBar.style.width = `${(completed / total) * 100}%`;
  if (overallText) overallText.textContent = `${completed} / ${total}`;
}

function showDispatchResult(results) {
  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  // Update title
  document.getElementById("progressIcon").textContent =
    failedCount > 0 ? "warning" : "check_circle";
  document.getElementById("progressIcon").className =
    "material-icons modal-icon";
  document.getElementById("progressIcon").style.color =
    failedCount > 0 ? "#d97706" : "#059669";
  document.getElementById("progressTitle").textContent = batchState.isDRTest
    ? t("dr_test_complete")
    : t("batch_complete");

  // Add result summary before progress list
  const progressList = document.getElementById("dispatchProgressList");
  const summaryDiv = document.createElement("div");
  summaryDiv.className = "dispatch-result-summary";
  summaryDiv.innerHTML = `
        <span class="result-success-count">${t("success_count")}: ${successCount}/${results.length}</span>
        <span class="result-failed-count">${t("failed_count")}: ${failedCount}/${results.length}</span>
    `;
  progressList.insertBefore(summaryDiv, progressList.firstChild);

  // DR Test aggregate summary
  if (batchState.isDRTest) {
    const successResults = results.filter((r) => r.success);
    if (successResults.length > 0) {
      const avgLatency = (
        successResults.reduce((s, r) => s + r.responseLatency, 0) /
        successResults.length
      ).toFixed(2);
      const totalPower = successResults
        .reduce((s, r) => s + r.actualPower, 0)
        .toFixed(2);
      const avgAccuracy = (
        successResults.reduce((s, r) => s + r.accuracy, 0) /
        successResults.length
      ).toFixed(1);

      const drSummary = document.createElement("div");
      drSummary.className = "dr-aggregate-summary";
      drSummary.innerHTML = `
        <h4 style="margin:0 0 0.5rem 0;font-size:0.875rem;">${t("dr_test_summary")}</h4>
        <div class="dispatch-dr-metrics" style="grid-template-columns:repeat(4,1fr);">
          <div class="dr-metric"><span>${t("assets_tested")}</span><strong>${successResults.length}</strong></div>
          <div class="dr-metric"><span>${t("avg_latency")}</span><strong>${avgLatency}s</strong></div>
          <div class="dr-metric"><span>${t("total_power")}</span><strong>${totalPower}kW</strong></div>
          <div class="dr-metric"><span>${t("avg_accuracy")}</span><strong>${avgAccuracy}%</strong></div>
        </div>
      `;
      progressList.insertBefore(drSummary, summaryDiv.nextSibling);
    }
  }

  // Update failed items with error reason
  results
    .filter((r) => !r.success)
    .forEach((r) => {
      const item = document.querySelector(
        `[data-progress-asset="${r.assetId}"]`,
      );
      if (item) {
        const detail = item.querySelector(".dispatch-item-detail");
        if (detail) {
          detail.textContent = t(r.error);
        }
      }
    });

  // Enable close button
  document.getElementById("closeProgressBtn").disabled = false;

  // Show retry button if there are failures
  if (failedCount > 0) {
    document.getElementById("retryBtn").style.display = "flex";
  }
}

export function closeProgressModal() {
  document.getElementById("batchProgressModal").classList.remove("show");
  batchState.isDRTest = false;
  resetBatchSelection();
}

// ============================================
// DR Test
// ============================================
export function startDRTest() {
  if (batchState.isDispatching) return;

  const assets = getAssets();

  // 1. Select all assets regardless of current state
  batchState.selectedAssets.clear();
  assets.forEach((a) => batchState.selectedAssets.add(a.id));

  // 2. Set target mode (use current selection or default to peak_valley_arbitrage)
  if (!batchState.targetMode) {
    batchState.targetMode = "peak_valley_arbitrage";
  }

  // 3. Mark as DR test and update UI
  batchState.isDRTest = true;
  updateBatchUI();

  // 4. Skip confirm modal, execute directly
  executeBatchDispatch();
}

export async function retryFailedItems() {
  const failedResults = batchState.dispatchResults.filter((r) => !r.success);
  const assets = getAssets();
  const failedAssets = failedResults
    .map((r) => assets.find((a) => a.id === r.assetId))
    .filter(Boolean);

  if (failedAssets.length === 0) return;

  // Keep only successful results
  batchState.dispatchResults = batchState.dispatchResults.filter(
    (r) => r.success,
  );
  batchState.isDispatching = true;

  // Reset UI for retry
  document.getElementById("progressIcon").textContent = "sync";
  document.getElementById("progressIcon").className =
    "material-icons modal-icon spinning";
  document.getElementById("progressIcon").style.color = "#3730a3";
  document.getElementById("progressTitle").textContent = t("batch_dispatching");
  document.getElementById("closeProgressBtn").disabled = true;
  document.getElementById("retryBtn").style.display = "none";

  // Remove summary
  const summary = document.querySelector(".dispatch-result-summary");
  if (summary) summary.remove();

  // Reset failed items UI
  failedAssets.forEach((asset) => {
    updateDispatchProgress(asset.id, "waiting", 0);
  });

  const total = batchState.dispatchResults.length + failedAssets.length;
  updateOverallProgress(total);

  for (let i = 0; i < failedAssets.length; i++) {
    const asset = failedAssets[i];
    updateDispatchProgress(asset.id, "executing", 0);

    const result = await simulateAssetModeChange(asset, batchState.targetMode);
    batchState.dispatchResults.push(result);

    updateDispatchProgress(
      asset.id,
      result.success ? "success" : "failed",
      100,
    );

    if (result.success) {
      updateAssetMode(asset.id, batchState.targetMode);
    }

    updateOverallProgress(total);
  }

  batchState.isDispatching = false;
  showDispatchResult(batchState.dispatchResults);

  // Refresh asset cards
  refreshAssets();
  updateBatchUI();
}

// ============================================
// Financial Collapsible Toggle
// ============================================

/**
 * Toggle the financial details collapsible section on a site card.
 * @param {string} panelId - The id attribute of the .financial-collapsible element
 */
export function toggleFinancialDetails(panelId) {
  const panel = document.getElementById(panelId);
  if (panel) {
    panel.classList.toggle("open");
  }
}

// Expose to global scope for inline onclick handlers
window.toggleFinancialDetails = toggleFinancialDetails;
