// ============================================
// SOLFACIL - Reports Module
// Period selector with working implementation
// ============================================

import { updateRevenueTrendPeriod } from './charts.js';

let currentPeriod = 7;

export function setPeriod(btn, days) {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentPeriod = days;
    updateRevenueTrendPeriod(days);
}

export function getCurrentPeriod() {
    return currentPeriod;
}
