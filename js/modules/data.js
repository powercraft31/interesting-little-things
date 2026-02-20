// ============================================
// SOLFACIL - Data Store Module
// Immutable data management with deep copy
// ============================================

const INITIAL_DATA = Object.freeze({
  assets: Object.freeze([
    Object.freeze({
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
    }),
    Object.freeze({
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
    }),
    Object.freeze({
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
    }),
    Object.freeze({
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
    }),
  ]),
  trades: Object.freeze([
    Object.freeze({
      time: "00:00 - 06:00",
      tarifa: "off_peak",
      operacao: "buy",
      preco: "R$ 0,25/kWh",
      volume: "15,6",
      resultado: "-R$ 3.900",
      status: "executed",
    }),
    Object.freeze({
      time: "06:00 - 09:00",
      tarifa: "intermediate",
      operacao: "hold",
      preco: "R$ 0,45/kWh",
      volume: "—",
      resultado: "R$ 0",
      status: "executed",
    }),
    Object.freeze({
      time: "09:00 - 12:00",
      tarifa: "intermediate",
      operacao: "partial_sell",
      preco: "R$ 0,52/kWh",
      volume: "8,2",
      resultado: "+R$ 4.264",
      status: "executed",
    }),
    Object.freeze({
      time: "12:00 - 15:00",
      tarifa: "intermediate",
      operacao: "hold",
      preco: "R$ 0,48/kWh",
      volume: "—",
      resultado: "R$ 0",
      status: "executed",
    }),
    Object.freeze({
      time: "15:00 - 17:00",
      tarifa: "intermediate",
      operacao: "partial_sell",
      preco: "R$ 0,55/kWh",
      volume: "6,8",
      resultado: "+R$ 3.740",
      status: "executed",
    }),
    Object.freeze({
      time: "17:00 - 20:00",
      tarifa: "peak",
      operacao: "total_sell",
      preco: "R$ 0,82/kWh",
      volume: "23,6",
      resultado: "+R$ 19.352",
      status: "executing",
    }),
    Object.freeze({
      time: "20:00 - 22:00",
      tarifa: "intermediate",
      operacao: "buy",
      preco: "R$ 0,42/kWh",
      volume: "10,8",
      resultado: "-R$ 4.536",
      status: "scheduled",
    }),
    Object.freeze({
      time: "22:00 - 00:00",
      tarifa: "off_peak",
      operacao: "buy",
      preco: "R$ 0,25/kWh",
      volume: "20,8",
      resultado: "-R$ 5.200",
      status: "scheduled",
    }),
  ]),
  revenueTrend: Object.freeze({
    receita: Object.freeze([42150, 38900, 45200, 48235, 51000, 39800, 41500]),
    custo: Object.freeze([9800, 8700, 10200, 10850, 11500, 9200, 9600]),
    lucro: Object.freeze([32350, 30200, 35000, 37385, 39500, 30600, 31900]),
  }),
  revenueBreakdown: Object.freeze({
    values: Object.freeze([32450, 12385, 3400]),
    colors: Object.freeze(["#3730a3", "#059669", "#d97706"]),
  }),
});

// Mutable working copy of assets (for mode changes during batch dispatch)
let workingAssets = deepCopy(INITIAL_DATA.assets);

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
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
// Public API
// ============================================

export function getAssets() {
  return deepCopy(workingAssets);
}

export function getAssetById(id) {
  const asset = workingAssets.find((a) => a.id === id);
  return asset ? deepCopy(asset) : null;
}

export function getTrades() {
  return deepCopy(INITIAL_DATA.trades);
}

export function getRevenueTrend() {
  return deepCopy(INITIAL_DATA.revenueTrend);
}

export function getRevenueBreakdown() {
  return deepCopy(INITIAL_DATA.revenueBreakdown);
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
  const base = 76.3;
  const delta = (Math.random() - 0.5) * 2;
  return { value: (base + delta).toFixed(1), delta: delta.toFixed(1) };
}

export function getForecastMAPE() {
  const base = 18.5;
  const delta = (Math.random() - 0.5) * 1;
  return { value: (base + delta).toFixed(1), delta: (-delta).toFixed(1) };
}

export function getSelfConsumptionRate() {
  const base = 98.2;
  const delta = (Math.random() - 0.5) * 0.5;
  return { value: (base + delta).toFixed(1), delta: delta.toFixed(1) };
}
