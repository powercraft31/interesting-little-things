// ============================================
// SOLFACIL - Market Conditions Module
// Real-time market data updates
// ============================================

import { t } from "../utils/i18n.js";
import { formatDate, formatNumber } from "../utils/format.js";
import { getLanguage } from "../utils/i18n.js";
import {
  getOptimizationAlpha,
  getForecastMAPE,
  getSelfConsumptionRate,
} from "./data.js";

export function setCurrentDate() {
  const el = document.getElementById("currentDate");
  if (el) el.textContent = formatDate(getLanguage());
}

export function updateFinancialMetrics() {
  const baseProfit = 48235;
  const variation = Math.floor(Math.random() * 1000 - 300);
  const todayProfit = baseProfit + variation;
  const revenue = todayProfit + 14215;
  const roi = (18.7 + (Math.random() * 0.4 - 0.2)).toFixed(1);

  const profitEl = document.getElementById("todayProfit");
  if (profitEl)
    profitEl.textContent = "R$ " + todayProfit.toLocaleString("pt-BR");

  const roiEl = document.getElementById("monthlyROI");
  if (roiEl) roiEl.textContent = "+" + roi + "%";

  const kpiRevEl = document.getElementById("kpiRevenue");
  if (kpiRevEl) kpiRevEl.textContent = "R$ " + revenue.toLocaleString("pt-BR");

  const kpiNetEl = document.getElementById("kpiNet");
  if (kpiNetEl)
    kpiNetEl.textContent = "R$ " + todayProfit.toLocaleString("pt-BR");

  // Update market conditions with translated text
  const hour = new Date().getHours();
  let tariff, price, margin, nextWindow, signal;

  if (hour >= 17 && hour < 20) {
    tariff = t("peak");
    price = "R$ 0,82/kWh";
    margin = "R$ 0,57/kWh";
    nextWindow = `20:00 (${t("intermediate")})`;
    signal = t("sell_now");
  } else if (hour >= 0 && hour < 6) {
    tariff = t("off_peak");
    price = "R$ 0,25/kWh";
    margin = "R$ 0,00/kWh";
    nextWindow = `06:00 (${t("intermediate")})`;
    signal = t("signal_buy_charge");
  } else if ((hour >= 6 && hour < 17) || (hour >= 20 && hour < 22)) {
    tariff = t("intermediate");
    price = "R$ 0,45/kWh";
    margin = "R$ 0,20/kWh";
    nextWindow =
      hour < 17
        ? `17:00 (${t("peak_max_margin")})`
        : `22:00 (${t("off_peak")})`;
    signal = hour < 17 ? t("signal_wait_peak") : t("signal_prepare_buy");
  } else {
    tariff = t("off_peak");
    price = "R$ 0,25/kWh";
    margin = "R$ 0,00/kWh";
    nextWindow = `00:00 (${t("off_peak")})`;
    signal = t("signal_buy_charge");
  }

  const tariffEl = document.getElementById("currentTariff");
  if (tariffEl) tariffEl.textContent = tariff;

  const badgeEl = document.getElementById("tariffBadge");
  if (badgeEl) {
    badgeEl.textContent = price;
    const isPeak = hour >= 17 && hour < 20;
    const isOffPeak = (hour >= 0 && hour < 6) || hour >= 22;
    badgeEl.className = isPeak
      ? "badge badge-peak"
      : isOffPeak
        ? "badge badge-offpeak"
        : "badge badge-mid";
  }

  const marginEl = document.getElementById("currentMargin");
  if (marginEl) marginEl.textContent = margin;

  const windowEl = document.getElementById("nextWindow");
  if (windowEl) windowEl.textContent = nextWindow;

  const signalEl = document.getElementById("marketSignal");
  if (signalEl) {
    const isSell = hour >= 17 && hour < 20;
    const isBuy = (hour >= 0 && hour < 6) || hour >= 22;
    signalEl.className =
      "market-signal" +
      (isSell ? " signal-sell" : isBuy ? " signal-buy" : " signal-wait");
    const icon = isSell ? "bolt" : isBuy ? "download" : "schedule";
    signalEl.innerHTML = `<span class="material-icons">${icon}</span><span id="marketSignalText">${signal}</span>`;
  }

  const spreadEl = document.getElementById("kpiSpread");
  if (spreadEl) spreadEl.textContent = margin;

  const activeEl = document.getElementById("activeAssets");
  if (activeEl) {
    const active = 2847 + Math.floor(Math.random() * 10 - 5);
    activeEl.textContent = formatNumber(active);
  }

  // Algorithm KPI Cards
  const alpha = getOptimizationAlpha();
  const alphaValEl = document.getElementById("kpiAlphaValue");
  if (alphaValEl) alphaValEl.textContent = alpha.value + "%";
  const alphaDeltaEl = document.getElementById("kpiAlphaDelta");
  if (alphaDeltaEl) {
    alphaDeltaEl.textContent =
      (alpha.delta >= 0 ? "+" : "") + alpha.delta + "%";
    alphaDeltaEl.className =
      "kpi-delta " + (alpha.delta >= 0 ? "positive" : "negative");
  }

  const mape = getForecastMAPE();
  const mapeValEl = document.getElementById("kpiMAPEValue");
  if (mapeValEl) mapeValEl.textContent = mape.value + "%";
  const mapeDeltaEl = document.getElementById("kpiMAPEDelta");
  if (mapeDeltaEl) {
    mapeDeltaEl.textContent = (mape.delta >= 0 ? "+" : "") + mape.delta + "%";
    mapeDeltaEl.className =
      "kpi-delta " + (mape.delta >= 0 ? "positive" : "negative");
  }

  const selfCon = getSelfConsumptionRate();
  const selfConValEl = document.getElementById("kpiSelfConValue");
  if (selfConValEl) selfConValEl.textContent = selfCon.value + "%";
  const selfConDeltaEl = document.getElementById("kpiSelfConDelta");
  if (selfConDeltaEl) {
    selfConDeltaEl.textContent =
      (selfCon.delta >= 0 ? "+" : "") + selfCon.delta + "%";
    selfConDeltaEl.className =
      "kpi-delta " + (selfCon.delta >= 0 ? "positive" : "negative");
  }
}
