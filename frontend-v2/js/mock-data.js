/* ============================================
   SOLFACIL Admin Portal — Mock Data
   All mock data managed centrally.
   Time-series: generator functions (NOT hardcoded arrays)
   Static data: const objects
   ============================================ */

// =========================================================
// 🚨 TARIFA BRANCA SCHEDULE (hardcoded — do NOT modify)
// =========================================================
const TARIFA_BRANCA = {
  peak: { start: 17, end: 20, price: 0.89 }, // R$/kWh
  intermediate: [
    { start: 16, end: 17, price: 0.62 },
    { start: 20, end: 21, price: 0.62 },
  ],
  offPeak: { price: 0.41 }, // all other hours (21:00–16:00)
  disco: "CEMIG",
};

function getTariffForHour(hour) {
  if (hour >= 17 && hour < 20) return { tier: "peak", price: 0.89 };
  if ((hour >= 16 && hour < 17) || (hour >= 20 && hour < 21))
    return { tier: "intermediate", price: 0.62 };
  return { tier: "off-peak", price: 0.41 };
}

// =========================================================
// 🚨 TIMEZONE DEFENSE: X-axis as pure string array
// =========================================================
const TIME_LABELS_15MIN = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_LABELS_15MIN.push(
      String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"),
    );
  }
}

// =========================================================
// STATIC MOCK DATA
// =========================================================
const DEVICE_TYPES = [
  { type: "Inverter + Battery", count: 20, online: 19, color: "#a855f7" },
  { type: "Smart Meter", count: 12, online: 12, color: "#06b6d4" },
  { type: "AC", count: 10, online: 9, color: "#3b82f6" },
  { type: "EV Charger", count: 5, online: 4, color: "#ec4899" },
];

const FLEET = {
  totalDevices: 47,
  onlineCount: 44,
  offlineCount: 3,
  onlineRate: 93.6,
  totalGateways: 4,
  totalIntegradores: 2,
  deviceTypes: DEVICE_TYPES,
};

const INTEGRADORES = [
  {
    orgId: "org-001",
    name: "Solar São Paulo",
    deviceCount: 26,
    onlineRate: 96.2,
    lastCommission: "28/02/2026",
  },
  {
    orgId: "org-002",
    name: "Green Energy Rio",
    deviceCount: 21,
    onlineRate: 90.5,
    lastCommission: "01/03/2026",
  },
];

const OFFLINE_EVENTS = [
  {
    deviceId: "DEV-017",
    start: "02/03/2026 14:30",
    durationHrs: 4.2,
    cause: "WiFi dropout",
    backfill: true,
  },
  {
    deviceId: "DEV-033",
    start: "01/03/2026 03:15",
    durationHrs: 12.0,
    cause: "Power outage",
    backfill: true,
  },
  {
    deviceId: "DEV-041",
    start: "03/03/2026 09:45",
    durationHrs: 2.1,
    cause: "Unknown",
    backfill: false,
  },
];

// =========================================================
// 28-DAY UPTIME TREND DATA
// =========================================================
function generateUptimeTrend() {
  const data = [];
  const baseDate = new Date(2026, 2, 4, 12, 0, 0); // March 4, 2026 noon — DST-safe anchor
  for (let i = 27; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dayLabel =
      String(d.getDate()).padStart(2, "0") +
      "/" +
      String(d.getMonth() + 1).padStart(2, "0");

    let uptime;
    // Two dip days: day 7 and day 18 from start
    if (i === 21) {
      uptime = 87.2;
    } else if (i === 10) {
      uptime = 87.8;
    } else {
      uptime = 91 + Math.random() * 5; // 91–96%
      uptime = Math.round(uptime * 10) / 10;
    }
    data.push({ date: dayLabel, uptime: uptime });
  }
  return data;
}

// =========================================================
// TIME-SERIES DATA GENERATORS (for P3/P5 charts)
// These run ONCE at page load and are memoized in DemoStore.
// 🚨 NEVER regenerate on page switch.
// =========================================================

function generateSolarCurve() {
  const data = [];
  for (let i = 0; i < 96; i++) {
    const hour = i * 0.25; // 0, 0.25, 0.5 ... 23.75
    let pv = 0;
    if (hour >= 6 && hour <= 18) {
      // Bell curve: sin() from 6:00 to 18:00, peak at 12:00
      const t = (hour - 6) / 12; // 0 to 1
      pv = 4.5 * Math.sin(Math.PI * t);
      // Add ±5% noise (seeded by index for stability)
      const noise = 1 + (((i * 7 + 13) % 100) / 100 - 0.5) * 0.1;
      pv *= noise;
      pv = Math.max(0, pv);
    }
    data.push(Math.round(pv * 100) / 100);
  }
  return data;
}

function generateLoadCurve() {
  const data = [];
  for (let i = 0; i < 96; i++) {
    const hour = i * 0.25;
    // Base load
    let load = 0.6;
    // Morning peak 07:00-09:00
    if (hour >= 6.5 && hour <= 9.5) {
      const t = (hour - 6.5) / 3;
      load += 1.5 * Math.sin(Math.PI * t);
    }
    // Evening peak 17:00-22:00
    if (hour >= 16.5 && hour <= 22) {
      const t = (hour - 16.5) / 5.5;
      load += 2.0 * Math.sin(Math.PI * t);
    }
    // Slight midday rise
    if (hour >= 11 && hour <= 15) {
      load += 0.3;
    }
    // Add ±5% noise (deterministic)
    const noise = 1 + (((i * 11 + 7) % 100) / 100 - 0.5) * 0.1;
    load *= noise;
    load = Math.max(0.3, load);
    data.push(Math.round(load * 100) / 100);
  }
  return data;
}

function generateBatteryCurve(pvCurve, loadCurve) {
  const data = [];
  const capacity = 10; // kWh
  let soc = 0.3; // Start at 30%
  const maxChargeRate = 3.0; // kW
  const maxDischargeRate = 3.0; // kW

  for (let i = 0; i < 96; i++) {
    const hour = i * 0.25;
    const tariff = getTariffForHour(Math.floor(hour));
    const pv = pvCurve[i];
    const load = loadCurve[i];
    const surplus = pv - load;
    let batteryPower = 0; // positive = charging, negative = discharging

    if (tariff.tier === "peak") {
      // Peak: discharge to reduce grid import
      const needed = load - pv;
      if (needed > 0 && soc > 0.1) {
        batteryPower = -Math.min(
          needed,
          maxDischargeRate,
          (soc - 0.1) * capacity * 4,
        );
      }
    } else if (tariff.tier === "intermediate") {
      // Intermediate: mild discharge if needed
      const needed = load - pv;
      if (needed > 0 && soc > 0.2) {
        batteryPower = -Math.min(
          needed * 0.5,
          maxDischargeRate * 0.5,
          (soc - 0.2) * capacity * 4,
        );
      }
    } else {
      // Off-peak: charge from grid if SoC low, or from PV surplus
      if (surplus > 0.3) {
        // Charge from PV surplus
        batteryPower = Math.min(
          surplus,
          maxChargeRate,
          (0.95 - soc) * capacity * 4,
        );
      } else if (soc < 0.8 && hour >= 0 && hour < 6) {
        // Night off-peak grid charging
        batteryPower = Math.min(2.0, maxChargeRate, (0.9 - soc) * capacity * 4);
      }
    }

    // Update SoC (15-min interval = 0.25 hour)
    soc += (batteryPower * 0.25) / capacity;
    soc = Math.max(0.05, Math.min(0.95, soc));

    data.push(Math.round(batteryPower * 100) / 100);
  }
  return data;
}

function generateGridCurve(loadCurve, pvCurve, batteryCurve) {
  // 🚨 Energy conservation: grid = load - pv + battery
  // (positive battery = charging = extra demand; negative = discharging = supplies load)
  return loadCurve.map((load, i) => {
    const grid = load - pvCurve[i] + batteryCurve[i];
    return Math.round(grid * 100) / 100;
  });
}

function generateBaselineGrid(loadCurve) {
  // Dumb baseline: no PV, no battery = 100% grid
  return loadCurve.map((v) => Math.round(v * 100) / 100);
}

function calculateSavings(baselineGrid, actualGrid) {
  // 🚨 savings_brl = Σ((baseline[t] - actual[t]) × tariff_price[t] × 0.25)
  let totalSavings = 0;
  for (let i = 0; i < 96; i++) {
    const hour = Math.floor(i * 0.25);
    const tariff = getTariffForHour(hour);
    const delta = baselineGrid[i] - actualGrid[i];
    totalSavings += delta * tariff.price * 0.25;
  }
  return Math.round(totalSavings * 100) / 100;
}

// =========================================================
// P3 GENERATORS: Battery SoC, AC schedule, EV schedule
// =========================================================

function generateBatterySoCCurve(batteryCurve) {
  const capacity = 10; // kWh (must match generateBatteryCurve)
  let soc = 0.3; // Start at 30% (must match)
  return batteryCurve.map(function (power) {
    soc += (power * 0.25) / capacity;
    soc = Math.max(0.05, Math.min(0.95, soc));
    return Math.round(soc * 1000) / 10; // Return as percentage 0–100
  });
}

function generateACPowerCurve(homeIdx) {
  var basePower = 0.8 + homeIdx * 0.2; // 0.8, 1.0, 1.2 kW per home
  return TIME_LABELS_15MIN.map(function (_, i) {
    var hour = i * 0.25;
    // Noise per slot (deterministic)
    var noise = 1 + (((i * 13 + 7 + homeIdx * 31) % 100) / 100 - 0.5) * 0.15;
    var power = basePower * noise;
    // AC on during warm daytime hours
    if (hour >= 10 && hour < 16) return Math.round(power * 100) / 100;
    // Peak shaving: AC forced off 17:00–20:00
    if (hour >= 17 && hour < 20) return 0;
    // Evening run after peak
    if (hour >= 20.5 && hour < 22) return Math.round(power * 100) / 100;
    return 0;
  });
}

function generateEVChargeCurve(homeIdx) {
  var fullRate = 7.4; // kW
  var slowRate = 3.5; // kW
  var nightStart = 1 + homeIdx * 0.5; // 1:00, 1:30, 2:00
  var nightEnd = 5 + homeIdx * 0.5; // 5:00, 5:30, 6:00
  return TIME_LABELS_15MIN.map(function (_, i) {
    var hour = i * 0.25;
    // Night off-peak charging
    if (hour >= nightStart && hour < nightEnd) return fullRate;
    // Midday PV surplus charging
    if (hour >= 11 && hour < 13.5) return slowRate;
    return 0;
  });
}

// =========================================================
// MOCK DATA INITIALIZATION (runs once on page load)
// =========================================================
var MOCK_DATA_VERSION = 3; // Bump when generators change

function initMockData() {
  // Only generate once — version check handles schema changes
  if (DemoStore.get("mockDataVersion") === MOCK_DATA_VERSION) return;
  DemoStore.reset(); // Clear stale data from previous version

  // Generate time-series for 3 homes
  var homes = ["home-a", "home-b", "home-c"];
  var homeData = {};

  homes.forEach(function (homeId, idx) {
    var pvScale = [1.0, 0.85, 1.15][idx]; // Different PV sizes
    var loadScale = [1.0, 1.2, 0.9][idx]; // Different consumption patterns

    var pv = generateSolarCurve().map(function (v) {
      return Math.round(v * pvScale * 100) / 100;
    });
    var load = generateLoadCurve().map(function (v) {
      return Math.round(v * loadScale * 100) / 100;
    });
    var battery = generateBatteryCurve(pv, load);
    var grid = generateGridCurve(load, pv, battery);
    var baseline = generateBaselineGrid(load);
    var savings = calculateSavings(baseline, grid);
    var soc = generateBatterySoCCurve(battery);
    var acPower = generateACPowerCurve(idx);
    var evCharge = generateEVChargeCurve(idx);

    // Generate 24h time labels ("00:00" to "23:00") — required by P3 _initMainChart
    var timeLabels = [];
    for (var h = 0; h < 24; h++) {
      timeLabels.push((h < 10 ? "0" : "") + h + ":00");
    }

    homeData[homeId] = {
      timeLabels: timeLabels,
      pv: pv,
      load: load,
      battery: battery,
      grid: grid,
      baseline: baseline,
      savings: savings,
      soc: soc,
      acPower: acPower,
      evCharge: evCharge,
    };
  });

  DemoStore.set("homeData", homeData);
  DemoStore.set("uptimeTrend", generateUptimeTrend());
  DemoStore.set("mockDataVersion", MOCK_DATA_VERSION);

  // Export uptimeTrend to global for DataSource fallback
  window.uptimeTrendData = DemoStore.get("uptimeTrend");
}

// =========================================================
// GATEWAY ENERGY MOCK (returns homeData by gateway index)
// =========================================================
window.getGatewayEnergyMock = function (gatewayId) {
  if (typeof DemoStore === "undefined") return {};
  var allData = DemoStore.get("homeData");
  if (!allData) return {};
  var keys = ["home-a", "home-b", "home-c"];
  var gwIds = [
    "WKRD24070202100144F",
    "WKRD24070202100228G",
    "WKRD24070202100212P",
  ];
  var idx = gwIds.indexOf(gatewayId);
  if (idx < 0) idx = 0;
  return allData[keys[idx]] || {};
};

// =========================================================
// BA_COMPARE (Before/After data for P3)
// =========================================================
var BA_COMPARE = {
  0: {
    before: { selfCons: 82, peakKw: 3.2, gridImport: 18.5 },
    after: { selfCons: 97, peakKw: 1.8, gridImport: 4.2 },
  },
  1: {
    before: { selfCons: 78, peakKw: 3.5, gridImport: 22.1 },
    after: { selfCons: 95, peakKw: 2.0, gridImport: 6.8 },
  },
  2: {
    before: { selfCons: 85, peakKw: 3.0, gridImport: 16.2 },
    after: { selfCons: 98, peakKw: 1.6, gridImport: 3.1 },
  },
};

// =========================================================
// GATEWAYS (v5.19: replaces HOMES)
// =========================================================
const GATEWAYS = [
  {
    gatewayId: "WKRD24070202100144F",
    name: "Residência Silva",
    orgId: "ORG_ENERGIA_001",
    orgName: "Solfacil Pilot Corp",
    status: "online",
    lastSeenAt: "2026-03-10T10:15:30Z",
    deviceCount: 12,
    emsHealth: {
      wifiRssi: -42,
      firmwareVersion: "v2.1.3",
      uptimeSeconds: 1231200,
      errorCodes: [],
    },
    contractedDemandKw: 15.0,
  },
  {
    gatewayId: "WKRD24070202100228G",
    name: "Residência Santos",
    orgId: "ORG_ENERGIA_001",
    orgName: "Solfacil Pilot Corp",
    status: "online",
    lastSeenAt: "2026-03-10T10:15:22Z",
    deviceCount: 8,
    emsHealth: {
      wifiRssi: -58,
      firmwareVersion: "v2.1.3",
      uptimeSeconds: 612000,
      errorCodes: [],
    },
    contractedDemandKw: 12.0,
  },
  {
    gatewayId: "WKRD24070202100212P",
    name: "Residência Oliveira",
    orgId: "ORG_ENERGIA_001",
    orgName: "Solfacil Pilot Corp",
    status: "offline",
    lastSeenAt: "2026-03-10T07:15:00Z",
    deviceCount: 6,
    emsHealth: {
      wifiRssi: null,
      firmwareVersion: "v2.0.8",
      uptimeSeconds: null,
      errorCodes: ["E_WIFI_LOST"],
    },
    contractedDemandKw: 10.0,
  },
  {
    gatewayId: "WKRD24070202100141I",
    name: "Test Gateway",
    orgId: "ORG_ENERGIA_001",
    orgName: "Solfacil Pilot Corp",
    status: "online",
    lastSeenAt: "2026-03-10T10:15:26Z",
    deviceCount: 0,
    emsHealth: {
      wifiRssi: -35,
      firmwareVersion: "v2.1.3",
      uptimeSeconds: 97200,
      errorCodes: [],
    },
    contractedDemandKw: null,
  },
];

// =========================================================
// DEVICE LIST (47 devices)
// Consistency: sums match DEVICE_TYPES, online=44, offline=3
// Offline IDs match OFFLINE_EVENTS: DEV-017, DEV-033, DEV-041
// org-001 = 26 devices, org-002 = 21 devices (matches INTEGRADORES)
// =========================================================
function generateDeviceTelemetry(type, seed, isOffline) {
  if (isOffline) {
    return { status: "offline", message: "No telemetry — device offline" };
  }
  // Deterministic pseudo-random based on seed
  const r = (base, range) =>
    Math.round((base + (((seed * 7 + 13) % 100) / 100) * range) * 100) / 100;

  switch (type) {
    case "Inverter + Battery":
      return {
        pvPower: r(2.5, 2.0),
        batterySoc: Math.min(95, 30 + ((seed * 13) % 65)),
        chargeRate: r(0.5, 2.0),
        gridExport: r(0.3, 1.5),
      };
    case "Smart Meter":
      return {
        consumption: r(1.0, 2.0),
        voltage: r(220, 8),
        current: r(5, 8),
        powerFactor: Math.min(1.0, r(0.85, 0.12)),
      };
    case "AC":
      return {
        on: seed % 3 !== 0,
        setTemp: 22 + (seed % 5),
        roomTemp: r(24, 4),
        powerDraw: seed % 3 !== 0 ? r(0.8, 0.8) : 0,
      };
    case "EV Charger":
      return {
        charging: seed % 2 === 0,
        chargeRate: seed % 2 === 0 ? r(3.5, 3.5) : 0,
        sessionEnergy: r(5, 25),
        evSoc: Math.min(98, 20 + ((seed * 11) % 75)),
      };
    default:
      return {};
  }
}

function generateDeviceList() {
  const devices = [];
  const offlineSet = new Set(["DEV-017", "DEV-033", "DEV-041"]);

  const typeNames = ["Inverter + Battery", "Smart Meter", "AC", "EV Charger"];

  const brandModels = {
    "Inverter + Battery": [
      { brand: "Growatt", model: "MIN 5000TL-XH" },
      { brand: "Sofar", model: "HYD 5000-ES" },
      { brand: "Goodwe", model: "GW5048-EM" },
      { brand: "Deye", model: "SUN-5K-SG04LP1" },
      { brand: "Huawei", model: "SUN2000-5KTL-M1" },
    ],
    "Smart Meter": [
      { brand: "Huawei", model: "DTSU666-H" },
      { brand: "Solis", model: "DTSD1352" },
      { brand: "Growatt", model: "SPM-3" },
    ],
    AC: [
      { brand: "Midea", model: "Springer R410A" },
      { brand: "Daikin", model: "Sensira R32" },
      { brand: "LG", model: "Dual Inverter S4-W12JA3AA" },
    ],
    "EV Charger": [
      { brand: "ABB", model: "Terra AC W7-T-0" },
      { brand: "Schneider", model: "EVlink Home" },
      { brand: "WEG", model: "WEMOB Smart 7.4" },
    ],
  };

  // Compact type map: 0=Inv+Bat, 1=SmartMeter, 2=AC, 3=EV
  // Crafted so offline IDs land on correct types:
  //   DEV-017 (idx16)→IB, DEV-033 (idx32)→AC, DEV-041 (idx40)→EV
  const TYPE_MAP = [
    // HOME-001: DEV-001..015 (6 IB, 4 SM, 3 AC, 2 EV)
    0, 1, 2, 3, 0, 1, 2, 0, 1, 2, 3, 0, 1, 0, 0,
    // HOME-002: DEV-016..026 (4 IB, 3 SM, 3 AC, 1 EV)
    1, 0, 2, 0, 1, 2, 0, 1, 2, 0, 3,
    // HOME-003: DEV-027..047 (10 IB, 5 SM, 4 AC, 2 EV)
    0, 1, 0, 1, 0, 0, 2, 0, 1, 2, 0, 1, 0, 2, 3, 0, 1, 2, 0, 0, 3,
  ];

  const homeBounds = [
    { idx: 0, start: 0, end: 14 },
    { idx: 1, start: 15, end: 25 },
    { idx: 2, start: 26, end: 46 },
  ];

  const brandCounter = {};

  for (let i = 0; i < 47; i++) {
    const num = i + 1;
    const deviceId = "DEV-" + String(num).padStart(3, "0");
    const type = typeNames[TYPE_MAP[i]];

    if (!brandCounter[type]) brandCounter[type] = 0;
    const models = brandModels[type];
    const bm = models[brandCounter[type] % models.length];
    brandCounter[type]++;

    const homeSpec = homeBounds.find((h) => i >= h.start && i <= h.end);
    const gw = GATEWAYS[homeSpec.idx];
    const isOffline = offlineSet.has(deviceId);

    const commDay = 15 + Math.floor(i / 5);
    const commDate =
      String(Math.min(commDay, 28)).padStart(2, "0") + "/02/2026";

    let lastSeen;
    if (isOffline) {
      const event = OFFLINE_EVENTS.find((e) => e.deviceId === deviceId);
      lastSeen = event ? event.start : "03/03/2026 08:00";
    } else {
      const hour = 8 + (num % 12);
      const minute = (num * 7) % 60;
      lastSeen =
        "04/03/2026 " +
        String(hour).padStart(2, "0") +
        ":" +
        String(minute).padStart(2, "0");
    }

    devices.push({
      deviceId,
      type,
      brand: bm.brand,
      model: bm.model,
      gatewayId: gw.gatewayId,
      gatewayName: gw.name,
      orgId: gw.orgId,
      orgName: gw.orgName,
      status: isOffline ? "offline" : "online",
      lastSeen,
      commissionDate: commDate,
      telemetry: generateDeviceTelemetry(type, num, isOffline),
    });
  }

  return devices;
}

const DEVICES = generateDeviceList();

// =========================================================
// UNASSIGNED DEVICES (Commissioning Wizard Step 3)
// =========================================================
const UNASSIGNED_DEVICES = [
  {
    deviceId: "DEV-048",
    type: "Inverter + Battery",
    brand: "Growatt",
    model: "MIN 5000TL-XH",
  },
  {
    deviceId: "DEV-049",
    type: "Smart Meter",
    brand: "Huawei",
    model: "DTSU666-H",
  },
  { deviceId: "DEV-050", type: "AC", brand: "Midea", model: "Springer R410A" },
  {
    deviceId: "DEV-051",
    type: "EV Charger",
    brand: "ABB",
    model: "Terra AC W7-T-0",
  },
];

// =========================================================
// P4: HEMS CONTROL DATA
// =========================================================
const MODE_DISTRIBUTION = {
  self_consumption: 22,
  peak_valley_arbitrage: 18,
  peak_shaving: 7,
};

const TARIFA_RATES = {
  disco: "CEMIG",
  peak: 0.89,
  intermediate: 0.62,
  offPeak: 0.41,
  effectiveDate: "01/01/2026",
  peakHours: "17:00-20:00",
  intermediateHours: "16:00-17:00 & 20:00-21:00",
};

const LAST_DISPATCH = {
  timestamp: "03/03/2026 14:30",
  fromMode: "peak_valley_arbitrage",
  toMode: "peak_shaving",
  affectedDevices: 7,
  successRate: 100,
  ackList: [
    {
      deviceId: "DEV-027",
      mode: "peak_shaving",
      status: "ack",
      responseTime: "0.8s",
    },
    {
      deviceId: "DEV-029",
      mode: "peak_shaving",
      status: "ack",
      responseTime: "1.2s",
    },
    {
      deviceId: "DEV-031",
      mode: "peak_shaving",
      status: "ack",
      responseTime: "0.5s",
    },
    {
      deviceId: "DEV-032",
      mode: "peak_shaving",
      status: "ack",
      responseTime: "2.1s",
    },
    {
      deviceId: "DEV-037",
      mode: "peak_shaving",
      status: "ack",
      responseTime: "1.7s",
    },
    {
      deviceId: "DEV-041",
      mode: "peak_shaving",
      status: "pending",
      responseTime: "\u2014",
    },
    {
      deviceId: "DEV-045",
      mode: "peak_shaving",
      status: "timeout",
      responseTime: "30s",
    },
  ],
};

// =========================================================
// P4: BATCH HISTORY MOCK (v6.0)
// =========================================================
var MOCK_DATA = {
  BATCH_HISTORY: {
    batches: [
      {
        batchId: "batch-1710400000000-a1b2",
        source: "p4",
        dispatchedAt: "2026-03-10T14:30:00Z",
        total: 3,
        successCount: 2,
        failedCount: 0,
        gateways: [
          { gatewayId: "WKRD24070202100144F", result: "accepted" },
          { gatewayId: "WKRD24070202100228G", result: "accepted" },
          { gatewayId: "WKRD24070202100212P", result: "pending" },
        ],
        samplePayload: {
          socMinLimit: 20,
          socMaxLimit: 95,
          maxChargeCurrent: 100,
          maxDischargeCurrent: 100,
          gridImportLimitKw: 3000,
          slots: [
            {
              mode: "self_consumption",
              startMinute: 0,
              endMinute: 1440,
            },
          ],
        },
      },
      {
        batchId: "batch-1710300000000-c3d4",
        source: "p4",
        dispatchedAt: "2026-03-09T10:15:00Z",
        total: 2,
        successCount: 2,
        failedCount: 0,
        gateways: [
          { gatewayId: "WKRD24070202100144F", result: "accepted" },
          { gatewayId: "WKRD24070202100228G", result: "accepted" },
        ],
        samplePayload: {
          socMinLimit: 15,
          socMaxLimit: 90,
          maxChargeCurrent: 100,
          maxDischargeCurrent: 100,
          gridImportLimitKw: 50,
          slots: [
            {
              mode: "peak_shaving",
              startMinute: 0,
              endMinute: 1440,
            },
          ],
        },
      },
    ],
  },
};

// =========================================================
// P4: HEMS TARGETING MOCK (v6.4 — 7 gateways, all eligibility states)
// =========================================================
MOCK_DATA.HEMS_TARGETING = {
  gateways: [
    {
      gatewayId: "GW-BR-001",
      name: "Gateway Alpha",
      homeAlias: "晨光宅",
      integrator: "Solar São Paulo",
      status: "online",
      deviceCount: 5,
      lastSeenAt: "2026-03-21T10:05:00Z",
      currentMode: "self_consumption",
      currentSlots: [
        { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
      ],
      hasActiveCommand: false,
      activeCommandBatchId: null,
    },
    {
      gatewayId: "GW-BR-002",
      name: "Gateway Beta",
      homeAlias: "星河居",
      integrator: "Solar São Paulo",
      status: "online",
      deviceCount: 3,
      lastSeenAt: "2026-03-21T10:04:30Z",
      currentMode: "peak_shaving",
      currentSlots: [{ mode: "peak_shaving", startMinute: 0, endMinute: 1440 }],
      hasActiveCommand: false,
      activeCommandBatchId: null,
    },
    {
      gatewayId: "GW-BR-003",
      name: "Gateway Gamma",
      homeAlias: "翠園",
      integrator: "Solar São Paulo",
      status: "online",
      deviceCount: 4,
      lastSeenAt: "2026-03-21T10:03:00Z",
      currentMode: "peak_valley_arbitrage",
      currentSlots: [
        {
          mode: "peak_valley_arbitrage",
          action: "charge",
          startMinute: 0,
          endMinute: 360,
        },
        {
          mode: "peak_valley_arbitrage",
          action: "discharge",
          startMinute: 360,
          endMinute: 1020,
        },
        {
          mode: "peak_valley_arbitrage",
          action: "charge",
          startMinute: 1020,
          endMinute: 1440,
        },
      ],
      hasActiveCommand: true,
      activeCommandBatchId: "batch-conflict-001",
    },
    {
      gatewayId: "GW-BR-004",
      name: "Gateway Delta",
      homeAlias: "松風閣",
      integrator: "Green Energy Rio",
      status: "online",
      deviceCount: 6,
      lastSeenAt: "2026-03-21T10:02:00Z",
      currentMode: "self_consumption",
      currentSlots: [
        { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
      ],
      hasActiveCommand: true,
      activeCommandBatchId: "batch-conflict-002",
    },
    {
      gatewayId: "GW-BR-005",
      name: "Gateway Epsilon",
      homeAlias: "明月莊",
      integrator: "Green Energy Rio",
      status: "offline",
      deviceCount: 2,
      lastSeenAt: "2026-03-20T18:30:00Z",
      currentMode: "peak_shaving",
      currentSlots: [{ mode: "peak_shaving", startMinute: 0, endMinute: 1440 }],
      hasActiveCommand: false,
      activeCommandBatchId: null,
    },
    {
      gatewayId: "GW-BR-006",
      name: "Gateway Zeta",
      homeAlias: "雲水間",
      integrator: "Solar São Paulo",
      status: "online",
      deviceCount: 4,
      lastSeenAt: "2026-03-21T10:04:50Z",
      currentMode: null,
      currentSlots: null,
      hasActiveCommand: false,
      activeCommandBatchId: null,
    },
    {
      gatewayId: "GW-BR-007",
      name: "Gateway Eta",
      homeAlias: null,
      integrator: "Green Energy Rio",
      status: "online",
      deviceCount: 3,
      lastSeenAt: "2026-03-21T10:01:00Z",
      currentMode: "self_consumption",
      currentSlots: [
        { mode: "self_consumption", startMinute: 0, endMinute: 1440 },
      ],
      hasActiveCommand: false,
      activeCommandBatchId: null,
    },
  ],
};

// =========================================================
// P5: VPP & DR DATA
// =========================================================
const VPP_CAPACITY = {
  totalCapacityKwh: 156.0,
  availableKwh: 112.3,
  aggregateSoc: 72,
  maxDischargeKw: 45.0,
  maxChargeKw: 38.0,
  dispatchableDevices: 41,
};

const LATENCY_TIERS = [
  { tier: "1s", successRate: 60 },
  { tier: "5s", successRate: 72 },
  { tier: "15s", successRate: 88 },
  { tier: "30s", successRate: 94 },
  { tier: "1min", successRate: 97 },
  { tier: "15min", successRate: 99 },
  { tier: "1h", successRate: 100 },
];

const DR_EVENTS = [
  {
    id: "EVT-001",
    type: "Discharge",
    triggeredAt: "01/03/2026 18:00",
    targetKw: 30,
    achievedKw: 28.5,
    accuracy: 95.0,
    participated: 38,
    failed: 3,
  },
  {
    id: "EVT-002",
    type: "Charge",
    triggeredAt: "02/03/2026 02:00",
    targetKw: 25,
    achievedKw: 24.8,
    accuracy: 99.2,
    participated: 41,
    failed: 0,
  },
  {
    id: "EVT-003",
    type: "Curtailment",
    triggeredAt: "02/03/2026 17:30",
    targetKw: 15,
    achievedKw: 14.1,
    accuracy: 94.0,
    participated: 35,
    failed: 6,
  },
  {
    id: "EVT-004",
    type: "Discharge",
    triggeredAt: "03/03/2026 18:00",
    targetKw: 35,
    achievedKw: 33.2,
    accuracy: 94.9,
    participated: 39,
    failed: 2,
  },
  {
    id: "EVT-005",
    type: "Charge",
    triggeredAt: "04/03/2026 01:00",
    targetKw: 20,
    achievedKw: 20.0,
    accuracy: 100,
    participated: 41,
    failed: 0,
  },
];

// =========================================================
// P6: PERFORMANCE SCORECARD DATA
// =========================================================
const SCORECARD = {
  hardware: [
    {
      name: "Commissioning Time",
      value: 95,
      unit: "min",
      target: "<120",
      status: "pass",
    },
    {
      name: "Offline Resilience",
      value: 72,
      unit: "hrs",
      target: "\u226572",
      status: "pass",
    },
    {
      name: "Uptime (4 weeks)",
      value: 93.6,
      unit: "%",
      target: ">90%",
      status: "pass",
    },
    {
      name: "First Telemetry",
      value: 18,
      unit: "hrs",
      target: "<24",
      status: "pass",
    },
  ],
  optimization: [
    {
      name: "Savings Alpha",
      value: 74.2,
      unit: "%",
      target: ">70%",
      status: "pass",
    },
    {
      name: "Self-Consumption",
      value: 96.8,
      unit: "%",
      target: ">98%",
      status: "near",
    },
    {
      name: "PV Forecast MAPE",
      value: 22.1,
      unit: "%",
      target: "<25%",
      status: "pass",
    },
    {
      name: "Load Forecast Adapt",
      value: 11,
      unit: "days",
      target: "<14",
      status: "pass",
    },
  ],
  operations: [
    {
      name: "Dispatch Accuracy",
      value: 91.3,
      unit: "%",
      target: "TBD",
      status: "na",
    },
    {
      name: "Training Time",
      value: 75,
      unit: "min",
      target: "<90",
      status: "pass",
    },
    {
      name: "Manual Interventions",
      value: 4,
      unit: "",
      target: "\u2014",
      status: "warn",
    },
    {
      name: "App Uptime",
      value: 99.2,
      unit: "%",
      target: ">99%",
      status: "pass",
    },
  ],
};

const SAVINGS_BY_HOME = [
  {
    home: "Residência Silva",
    total: 145.0,
    alpha: 74.2,
    sc: 85,
    tou: 40,
    ps: 20,
  },
  {
    home: "Residência Santos",
    total: 118.5,
    alpha: 68.1,
    sc: 65,
    tou: 35,
    ps: 18.5,
  },
  {
    home: "Residência Oliveira",
    total: 167.3,
    alpha: 79.5,
    sc: 95,
    tou: 48,
    ps: 24.3,
  },
];

// =========================================================
// v5.19: MOCK GATEWAY DEVICES (per-gateway device lists)
// =========================================================
const MOCK_GW_DEVICES = {
  WKRD24070202100144F: {
    gateway: {
      gatewayId: "WKRD24070202100144F",
      name: "Residência Silva",
      status: "online",
    },
    devices: DEVICES.filter(function (d) {
      return d.gatewayId === "WKRD24070202100144F";
    }).map(function (d) {
      return {
        assetId: d.deviceId,
        name: d.deviceId,
        assetType: d.type,
        brand: d.brand,
        model: d.model,
        serialNumber: "SN-" + d.deviceId,
        capacidadeKw: 5.0,
        capacityKwh: 10.0,
        operationMode: "self_consumption",
        allowExport: false,
        isActive: true,
        state: {
          batterySoc: d.telemetry.batterySoc || 72,
          batteryPower: d.telemetry.chargeRate || 2.3,
          pvPower: d.telemetry.pvPower || 3.2,
          gridPowerKw: d.telemetry.gridExport ? -d.telemetry.gridExport : -0.7,
          loadPower: 4.8,
          inverterTemp: 42.0,
          batSoh: 96.0,
          batteryTemperature: 28.0,
          isOnline: d.status === "online",
        },
      };
    }),
  },
  WKRD24070202100228G: {
    gateway: {
      gatewayId: "WKRD24070202100228G",
      name: "Residência Santos",
      status: "online",
    },
    devices: DEVICES.filter(function (d) {
      return d.gatewayId === "WKRD24070202100228G";
    }).map(function (d) {
      return {
        assetId: d.deviceId,
        name: d.deviceId,
        assetType: d.type,
        brand: d.brand,
        model: d.model,
        serialNumber: "SN-" + d.deviceId,
        capacidadeKw: 5.0,
        capacityKwh: 10.0,
        operationMode: "peak_valley_arbitrage",
        allowExport: false,
        isActive: true,
        state: {
          batterySoc: d.telemetry.batterySoc || 65,
          batteryPower: d.telemetry.chargeRate || 1.8,
          pvPower: d.telemetry.pvPower || 2.8,
          gridPowerKw: d.telemetry.gridExport ? -d.telemetry.gridExport : 0.3,
          loadPower: 3.5,
          inverterTemp: 38.0,
          batSoh: 94.0,
          batteryTemperature: 26.0,
          isOnline: d.status === "online",
        },
      };
    }),
  },
  WKRD24070202100212P: {
    gateway: {
      gatewayId: "WKRD24070202100212P",
      name: "Residência Oliveira",
      status: "offline",
    },
    devices: DEVICES.filter(function (d) {
      return d.gatewayId === "WKRD24070202100212P";
    }).map(function (d) {
      return {
        assetId: d.deviceId,
        name: d.deviceId,
        assetType: d.type,
        brand: d.brand,
        model: d.model,
        serialNumber: "SN-" + d.deviceId,
        capacidadeKw: 5.0,
        capacityKwh: 10.0,
        operationMode: "peak_shaving",
        allowExport: true,
        isActive: true,
        state: {
          batterySoc: d.telemetry.batterySoc || 45,
          batteryPower: 0,
          pvPower: 0,
          gridPowerKw: 0,
          loadPower: 0,
          inverterTemp: 0,
          batSoh: 92.0,
          batteryTemperature: 24.0,
          isOnline: false,
        },
      };
    }),
  },
  WKRD24070202100141I: {
    gateway: {
      gatewayId: "WKRD24070202100141I",
      name: "Test Gateway",
      status: "online",
    },
    devices: [],
  },
};

// =========================================================
// v5.19: DEVICE DETAIL MOCK
// =========================================================
const MOCK_DEVICE_DETAIL = {
  device: {
    assetId: "DEV-001",
    name: "INV-BAT-001",
    assetType: "Inverter + Battery",
    brand: "Growatt",
    model: "MIN 5000TL-XH",
    serialNumber: "GW5048EM2301001",
    capacidadeKw: 5.0,
    capacityKwh: 10.0,
    operationMode: "self_consumption",
    allowExport: false,
    retailBuyRateKwh: 0.8,
    retailSellRateKwh: 0.25,
    gatewayId: "WKRD24070202100144F",
    gatewayName: "Residência Silva",
    gatewayStatus: "online",
  },
  state: {
    batterySoc: 72.0,
    batSoh: 96.0,
    batteryVoltage: 51.2,
    batteryCurrent: 45.1,
    batteryTemperature: 28.0,
    batteryPower: 2.3,
    pvPower: 3.2,
    gridPowerKw: -0.7,
    loadPower: 4.8,
    flloadPower: 5.1,
    inverterTemp: 42.0,
    maxChargeCurrent: 100.0,
    maxDischargeCurrent: 100.0,
    isOnline: true,
    updatedAt: "2026-03-10T10:15:30Z",
  },
  telemetryExtra: {
    gridVoltageR: 221.0,
    gridCurrentR: 3.2,
    gridPf: 0.97,
    totalBuyKwh: 1247.3,
    totalSellKwh: 892.1,
  },
  config: {
    socMin: 10,
    socMax: 95,
    maxChargeRateKw: 5.0,
    maxDischargeRateKw: 5.0,
    gridImportLimitKw: 3.0,
    defaults: { socMin: 20, socMax: 95, source: "vpp_strategies" },
  },
};

// =========================================================
// v5.19: DEVICE SCHEDULE MOCK
// =========================================================
const MOCK_DEVICE_SCHEDULE = {
  syncStatus: "synced",
  lastAckAt: "2026-03-10T10:15:18Z",
  slots: [
    { startHour: 0, endHour: 5, mode: "peak_valley_arbitrage" },
    { startHour: 5, endHour: 17, mode: "self_consumption" },
    { startHour: 17, endHour: 20, mode: "peak_shaving" },
    { startHour: 20, endHour: 24, mode: "peak_valley_arbitrage" },
  ],
};

// =========================================================
// BRAZILIAN LOCALE FORMATTERS
// =========================================================
function formatBRL(value) {
  // R$ 1.234,56
  const abs = Math.abs(value);
  const parts = abs.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = value >= 0 ? "+" : "-";
  return sign + "R$ " + intPart + "," + parts[1];
}

function formatPercent(value) {
  if (value == null || (typeof value === "number" && isNaN(value))) return "—";
  return value.toFixed(1).replace(".", ",") + "%";
}

function formatNumber(value, decimals) {
  if (value == null || (typeof value === "number" && isNaN(value))) return "—";
  if (decimals === undefined) decimals = 0;
  if (decimals === 0) return value.toLocaleString("pt-BR");
  return value.toFixed(decimals).replace(".", ",");
}
