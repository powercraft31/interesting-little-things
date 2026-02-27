// ============================================
// SOLFACIL VPP v2.0 — Developer Unit Tests
// Pure Vanilla JS (no framework)
// Run via: test-energy-flow.html
// ============================================

import { getGridClass, getBatClass, getSocBarClass } from './modules/batch-ops.js';
import { getAssets } from './modules/data.js';

// ── Test runner ──────────────────────────────
let _passed = 0;
let _failed = 0;
const _results = [];

function assert(description, actual, expected) {
  const pass = actual === expected;
  if (pass) {
    _passed++;
    _results.push({ pass: true, description, actual, expected });
  } else {
    _failed++;
    _results.push({ pass: false, description, actual, expected });
    console.error(`[FAIL] ${description}\n  Expected: ${JSON.stringify(expected)}\n  Got:      ${JSON.stringify(actual)}`);
  }
}

function assertApprox(description, actual, expected, tolerance = 0.5) {
  const pass = Math.abs(actual - expected) <= tolerance;
  if (pass) {
    _passed++;
    _results.push({ pass: true, description, actual, expected });
  } else {
    _failed++;
    _results.push({ pass: false, description, actual, expected });
    console.error(`[FAIL] ${description}\n  Expected: ${expected} ± ${tolerance}\n  Got:      ${actual}`);
  }
}

// ── Suite 1: Math.abs() 絕對值轉換 ───────────────
function testAbsConversion() {
  // Grid: 賣電 (negative) → displayed as positive
  assert('abs(grid -2.5) = 2.5',     Math.abs(-2.5),  2.5);
  assert('abs(grid  2.0) = 2.0',     Math.abs(2.0),   2.0);
  assert('abs(grid  0.0) = 0.0',     Math.abs(0.0),   0.0);

  // Battery: charging positive value → displayed as positive
  assert('abs(bat  1.6) = 1.6',      Math.abs(1.6),   1.6);
  assert('abs(bat -4.5) = 4.5',      Math.abs(-4.5),  4.5);
}

// ── Suite 2: Grid Class 狀態類名 ─────────────────
function testGridClass() {
  assert('grid  2.0 → importing',    getGridClass(2.0),   'importing');
  assert('grid  0.1 → importing',    getGridClass(0.1),   'importing');
  assert('grid -2.5 → exporting',    getGridClass(-2.5),  'exporting');
  assert('grid -0.1 → exporting',    getGridClass(-0.1),  'exporting');
  assert('grid  0.0 → ""',           getGridClass(0.0),   '');
  assert('grid  0.04 → "" (neutral)',getGridClass(0.04),  '');   // below 0.05 threshold
  assert('grid -0.04 → "" (neutral)',getGridClass(-0.04), '');
}

// ── Suite 3: Battery Class + SOC 分級 ────────────
function testBatClass() {
  assert('bat charging   → .charging',    getBatClass('charging'),    'charging');
  assert('bat discharging → .discharging', getBatClass('discharging'), 'discharging');
  assert('bat idle        → ""',           getBatClass('idle'),        '');
  assert('bat ""          → ""',           getBatClass(''),            '');
}

function testSocBarClass() {
  assert('SOC 65  → soc-high',    getSocBarClass(65),  'soc-high');
  assert('SOC 41  → soc-high',    getSocBarClass(41),  'soc-high');
  assert('SOC 40  → soc-medium',  getSocBarClass(40),  'soc-medium');
  assert('SOC 25  → soc-medium',  getSocBarClass(25),  'soc-medium');
  assert('SOC 21  → soc-medium',  getSocBarClass(21),  'soc-medium');
  assert('SOC 20  → soc-low',     getSocBarClass(20),  'soc-low');
  assert('SOC 10  → soc-low',     getSocBarClass(10),  'soc-low');
  assert('SOC 0   → soc-low',     getSocBarClass(0),   'soc-low');
}

// ── Suite 4: 能量守恆校驗 ────────────────────────
// Formula:
//   supply = pv_power + max(grid_power_kw, 0) + max(-battery_power, 0)
//   demand = load_power + max(-grid_power_kw, 0) + max(battery_power, 0)
//   |supply - demand| ≤ 0.5 kW
function testEnergyConservation() {
  const assets = getAssets();
  assets.forEach((asset) => {
    const m = asset.metering || {};
    const pv   = m.pv_power       ?? 0;
    const bat  = m.battery_power  ?? 0;
    const grid = m.grid_power_kw  ?? 0;
    const load = m.load_power     ?? 0;

    const supply = pv   + Math.max(grid, 0)  + Math.max(-bat, 0);
    const demand = load + Math.max(-grid, 0) + Math.max(bat, 0);

    assertApprox(
      `[${asset.id}] 能量守恆 (supply=${supply.toFixed(2)}, demand=${demand.toFixed(2)})`,
      supply,
      demand,
      0.5
    );
  });
}

// ── Run all suites ────────────────────────────
export function runAllTests() {
  _passed = 0;
  _failed = 0;
  _results.length = 0;

  testAbsConversion();
  testGridClass();
  testBatClass();
  testSocBarClass();
  testEnergyConservation();

  return { passed: _passed, failed: _failed, results: [..._results] };
}
