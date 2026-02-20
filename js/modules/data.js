// ============================================
// SOLFACIL - Data Store Module
// Immutable data management with deep copy
// Supports BFF fetch (CONFIG.USE_MOCK=false) or local mock fallback
// ============================================

import { getToken } from "./auth.js";

// ============================================
// Mock Data (used when CONFIG.USE_MOCK=true or BFF unavailable)
// ============================================
const MOCK_ASSETS = [
  {
    id: "ASSET_SP_001",
    name: "São Paulo - Casa Verde",
    region: "SP",
    status: "operando",
    investimento: 4200000,
    capacidade: 5.2,
    unidades: 948,
    socMedio: 65,
    receitaHoje: 18650,
    receitaMes: 412300,
    roi: 19.2,
    custoHoje: 4250,
    lucroHoje: 14400,
    payback: "3,8",
    operationMode: "peak_valley_arbitrage",
  },
  {
    id: "ASSET_RJ_002",
    name: "Rio de Janeiro - Copacabana",
    region: "RJ",
    status: "operando",
    investimento: 3800000,
    capacidade: 4.8,
    unidades: 872,
    socMedio: 72,
    receitaHoje: 16420,
    receitaMes: 378500,
    roi: 17.8,
    custoHoje: 3890,
    lucroHoje: 12530,
    payback: "4,1",
    operationMode: "self_consumption",
  },
  {
    id: "ASSET_MG_003",
    name: "Belo Horizonte - Pampulha",
    region: "MG",
    status: "operando",
    investimento: 2900000,
    capacidade: 3.6,
    unidades: 654,
    socMedio: 58,
    receitaHoje: 11280,
    receitaMes: 298400,
    roi: 16.4,
    custoHoje: 2680,
    lucroHoje: 8600,
    payback: "4,5",
    operationMode: "peak_valley_arbitrage",
  },
  {
    id: "ASSET_PR_004",
    name: "Curitiba - Batel",
    region: "PR",
    status: "carregando",
    investimento: 1500000,
    capacidade: 2.0,
    unidades: 373,
    socMedio: 34,
    receitaHoje: 6100,
    receitaMes: 145800,
    roi: 15.1,
    custoHoje: 1895,
    lucroHoje: 4205,
    payback: "4,8",
    operationMode: "peak_shaving",
  },
];

const MOCK_TRADES = [
  {
    time: "00:00 - 06:00",
    tarifa: "off_peak",
    operacao: "buy",
    preco: "R$ 0,25/kWh",
    volume: "15,6",
    resultado: "-R$ 3.900",
    status: "executed",
  },
  {
    time: "06:00 - 09:00",
    tarifa: "intermediate",
    operacao: "hold",
    preco: "R$ 0,45/kWh",
    volume: "\u2014",
    resultado: "R$ 0",
    status: "executed",
  },
  {
    time: "09:00 - 12:00",
    tarifa: "intermediate",
    operacao: "partial_sell",
    preco: "R$ 0,52/kWh",
    volume: "8,2",
    resultado: "+R$ 4.264",
    status: "executed",
  },
  {
    time: "12:00 - 15:00",
    tarifa: "intermediate",
    operacao: "hold",
    preco: "R$ 0,48/kWh",
    volume: "\u2014",
    resultado: "R$ 0",
    status: "executed",
  },
  {
    time: "15:00 - 17:00",
    tarifa: "intermediate",
    operacao: "partial_sell",
    preco: "R$ 0,55/kWh",
    volume: "6,8",
    resultado: "+R$ 3.740",
    status: "executed",
  },
  {
    time: "17:00 - 20:00",
    tarifa: "peak",
    operacao: "total_sell",
    preco: "R$ 0,82/kWh",
    volume: "23,6",
    resultado: "+R$ 19.352",
    status: "executing",
  },
  {
    time: "20:00 - 22:00",
    tarifa: "intermediate",
    operacao: "buy",
    preco: "R$ 0,42/kWh",
    volume: "10,8",
    resultado: "-R$ 4.536",
    status: "scheduled",
  },
  {
    time: "22:00 - 00:00",
    tarifa: "off_peak",
    operacao: "buy",
    preco: "R$ 0,25/kWh",
    volume: "20,8",
    resultado: "-R$ 5.200",
    status: "scheduled",
  },
];

const MOCK_REVENUE_TREND = {
  receita: [42150, 38900, 45200, 48235, 51000, 39800, 41500],
  custo: [9800, 8700, 10200, 10850, 11500, 9200, 9600],
  lucro: [32350, 30200, 35000, 37385, 39500, 30600, 31900],
};

const MOCK_DASHBOARD = {
  alpha: { value: "76.3", delta: "0.0" },
  mape: { value: "18.5", delta: "0.0" },
  selfConsumption: { value: "98.2", delta: "0.0" },
  revenueBreakdown: {
    values: [32450, 12385, 3400],
    colors: ["#3730a3", "#059669", "#d97706"],
  },
};

// ============================================
// Module-level data stores (populated by initData)
// ============================================
let workingAssets = [];
let tradesData = [];
let revenueTrendData = {};
let dashboardData = {};

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ============================================
// BFF Fetch Helper
// ============================================
async function fetchBff(path) {
  const baseUrl =
    typeof CONFIG !== "undefined"
      ? CONFIG.BFF_API_URL
      : "http://localhost:3001";

  const token = getToken();
  const headers = token ? { Authorization: JSON.stringify(token) } : {};

  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (response.status === 401) {
    const authError = new Error("Unauthorized");
    authError.status = 401;
    throw authError;
  }
  if (!response.ok) {
    throw new Error(`BFF ${path} returned ${response.status}`);
  }
  const envelope = await response.json();
  if (!envelope.success) {
    throw new Error(envelope.error || `BFF ${path} failed`);
  }
  return envelope.data;
}

// ============================================
// Data Initialization (call before UI rendering)
// ============================================
export async function initData() {
  const useMock = typeof CONFIG === "undefined" || CONFIG.USE_MOCK;

  if (!useMock) {
    try {
      const [dashboard, assets, revenueTrend, trades] = await Promise.all([
        fetchBff("/dashboard"),
        fetchBff("/assets"),
        fetchBff("/revenue-trend"),
        fetchBff("/trades"),
      ]);
      dashboardData = dashboard;
      // BFF /assets returns { assets: [...], _tenant: {...} } after RBAC upgrade
      workingAssets = deepCopy(Array.isArray(assets) ? assets : assets.assets);
      revenueTrendData = revenueTrend;
      tradesData = Array.isArray(trades) ? deepCopy(trades) : deepCopy(trades.trades ?? trades);
      console.log("[SOLFACIL] Data loaded from BFF");
      return;
    } catch (err) {
      if (err.status === 401) {
        throw err; // Let app.js handle 401 (show login modal)
      }
      console.warn(
        "[SOLFACIL] BFF fetch failed, falling back to mock data:",
        err.message,
      );
    }
  }

  // Mock fallback
  dashboardData = deepCopy(MOCK_DASHBOARD);
  workingAssets = deepCopy(MOCK_ASSETS);
  revenueTrendData = deepCopy(MOCK_REVENUE_TREND);
  tradesData = deepCopy(MOCK_TRADES);
  console.log("[SOLFACIL] Data loaded from local mock");
}

// ============================================
// Operation Modes Definition
// ============================================
export const OPERATION_MODES = Object.freeze({
  self_consumption: {
    key: "self_consumption",
    icon: "home",
    color: "#059669",
    bgColor: "#ecfdf5",
    borderColor: "#a7f3d0",
  },
  peak_valley_arbitrage: {
    key: "peak_valley_arbitrage",
    icon: "swap_vert",
    color: "#3730a3",
    bgColor: "#eef2ff",
    borderColor: "#c7d2fe",
  },
  peak_shaving: {
    key: "peak_shaving",
    icon: "compress",
    color: "#d97706",
    bgColor: "#fffbeb",
    borderColor: "#fde68a",
  },
});

// ============================================
// Public API (synchronous getters — data must be initialized first)
// ============================================

export function getAssets() {
  return deepCopy(workingAssets);
}

export function getAssetById(id) {
  const asset = workingAssets.find((a) => a.id === id);
  return asset ? deepCopy(asset) : null;
}

export function getTrades() {
  return deepCopy(tradesData);
}

export function getRevenueTrend() {
  return deepCopy(revenueTrendData);
}

export function getRevenueBreakdown() {
  return deepCopy(dashboardData.revenueBreakdown);
}

export function getAssetCount() {
  return workingAssets.length;
}

/**
 * Update an asset's operation mode (returns new asset list)
 */
export function updateAssetMode(assetId, newMode) {
  workingAssets = workingAssets.map((asset) =>
    asset.id === assetId ? { ...asset, operationMode: newMode } : asset,
  );
  return getAssets();
}

/**
 * Generate 24h baseline cost without battery optimization (Tarifa Branca rates)
 * Represents the "dumb" scenario: household pays grid rates directly
 */
export function generateBaselineCost() {
  const TARIFA_PEAK = 0.82; // 17-20h
  const TARIFA_INTERMEDIATE = 0.45; // 6-17h, 20-22h
  const TARIFA_OFFPEAK = 0.25; // 0-6h, 22-24h

  return Array.from({ length: 24 }, (_, hour) => {
    let consumption, rate;
    if (hour >= 17 && hour < 20) {
      // Peak: high household load (cooking, AC, lighting)
      consumption = 16800 + Math.random() * 1200 - 600;
      rate = TARIFA_PEAK;
    } else if ((hour >= 6 && hour < 17) || (hour >= 20 && hour < 22)) {
      // Intermediate: moderate household load
      consumption = 8500 + Math.random() * 1000 - 500;
      rate = TARIFA_INTERMEDIATE;
    } else {
      // Off-peak: base load (refrigerator, standby)
      consumption = 7200 + Math.random() * 800 - 400;
      rate = TARIFA_OFFPEAK;
    }
    return Math.round(consumption * rate);
  });
}

/**
 * Get assets that need mode change (selected + different from target)
 */
export function getAssetsToChange(selectedIds, targetMode) {
  return workingAssets
    .filter(
      (asset) =>
        selectedIds.has(asset.id) && asset.operationMode !== targetMode,
    )
    .map((asset) => deepCopy(asset));
}

// ============================================
// Algorithm KPI Data Functions
// ============================================

export function getOptimizationAlpha() {
  const base = parseFloat(dashboardData.alpha?.value ?? "76.3");
  const delta = (Math.random() - 0.5) * 2;
  return { value: (base + delta).toFixed(1), delta: delta.toFixed(1) };
}

export function getForecastMAPE() {
  const base = parseFloat(dashboardData.mape?.value ?? "18.5");
  const delta = (Math.random() - 0.5) * 1;
  return { value: (base + delta).toFixed(1), delta: (-delta).toFixed(1) };
}

export function getSelfConsumptionRate() {
  const base = parseFloat(dashboardData.selfConsumption?.value ?? "98.2");
  const delta = (Math.random() - 0.5) * 0.5;
  return { value: (base + delta).toFixed(1), delta: delta.toFixed(1) };
}

// ============================================
// Site Analytics Data (Drilldown Modal)
// ============================================

export function generateSiteAnalyticsData(assetId) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const seed = assetId.charCodeAt(0) + assetId.length;

  // PV generation: bell curve peaking at noon (6-18h active)
  const pvGeneration = hours.map((h) => {
    if (h < 6 || h > 18) return 0;
    const peak = 8 + (seed % 5); // 8-12 kW peak
    const x = (h - 12) / 3;
    return parseFloat(
      (peak * Math.exp(-0.5 * x * x) * (0.9 + Math.random() * 0.2)).toFixed(2),
    );
  });

  // Household load: higher in morning (7-9h) and evening (18-22h)
  const householdLoad = hours.map((h) => {
    let base = 1.5 + (seed % 3) * 0.5;
    if (h >= 7 && h <= 9) base += 2 + Math.random();
    else if (h >= 18 && h <= 22) base += 3 + Math.random() * 1.5;
    else if (h >= 0 && h <= 5) base *= 0.5;
    return parseFloat((base * (0.9 + Math.random() * 0.2)).toFixed(2));
  });

  // Battery power: charging=NEGATIVE (off-peak absorb), discharging=POSITIVE (peak inject)
  const batteryPower = hours.map((h) => {
    if (h >= 0 && h <= 5) {
      // Off-peak: charging (negative)
      return parseFloat((-3 - Math.random() * 2).toFixed(2));
    } else if (h >= 6 && h <= 9) {
      // Morning: use PV to charge (slightly negative or zero)
      return parseFloat((-1 - Math.random()).toFixed(2));
    } else if (h >= 17 && h <= 20) {
      // Peak hours: discharge to grid (positive)
      return parseFloat((4 + Math.random() * 3).toFixed(2));
    } else if (h >= 22) {
      // Late night: charge (negative)
      return parseFloat((-2 - Math.random()).toFixed(2));
    }
    return parseFloat(((Math.random() - 0.5) * 1.5).toFixed(2));
  });

  // Calculate summary metrics
  const peakDischarge = Math.max(...batteryPower);
  const dailyPV = pvGeneration.reduce((a, b) => a + b, 0);
  const totalLoad = householdLoad.reduce((a, b) => a + b, 0);
  const selfSufficiency = Math.min(
    100,
    parseFloat(((dailyPV / totalLoad) * 100).toFixed(1)),
  );
  const cycles = parseFloat(
    (
      batteryPower.filter((p) => p < 0).reduce((a, b) => a + Math.abs(b), 0) /
      20
    ).toFixed(2),
  );

  return {
    labels: hours.map((h) => h.toString().padStart(2, "0") + ":00"),
    pvGeneration,
    householdLoad,
    batteryPower,
    metrics: {
      peakDischarge,
      dailyPV: parseFloat(dailyPV.toFixed(1)),
      selfSufficiency,
      cycles,
    },
  };
}
