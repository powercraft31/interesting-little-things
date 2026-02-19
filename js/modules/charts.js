// ============================================
// SOLFACIL - Charts Module
// All Chart.js initialization and updates
// ============================================

import { t } from '../utils/i18n.js';
import { getRevenueTrend, getRevenueBreakdown } from './data.js';

let revenueCurveChart = null;
let arbitrageChart = null;
let revenueTrendChart = null;
let revenueBreakdownChart = null;

// ============================================
// Revenue vs Cost Curve (24h)
// ============================================
function initializeRevenueCurveChart() {
    const ctx = document.getElementById('revenueCurveChart');
    if (!ctx) return;

    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

    const revenueData = hours.map((_, i) => {
        if (i >= 17 && i < 20) return Math.random() * 3000 + 6000;
        if ((i >= 9 && i < 12) || (i >= 15 && i < 17)) return Math.random() * 1500 + 1500;
        return 0;
    });

    const costData = hours.map((_, i) => {
        if (i < 6 || i >= 22) return Math.random() * 400 + 500;
        if (i >= 20 && i < 22) return Math.random() * 300 + 400;
        return 0;
    });

    let accumulated = 0;
    const profitData = hours.map((_, i) => {
        accumulated += (revenueData[i] - costData[i]);
        return accumulated;
    });

    revenueCurveChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [
                {
                    label: `${t('revenue')} (R$)`,
                    data: revenueData,
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    tension: 0.4,
                    fill: false,
                    borderWidth: 2
                },
                {
                    label: `${t('cost')} (R$)`,
                    data: costData,
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    tension: 0.4,
                    fill: false,
                    borderWidth: 2
                },
                {
                    label: `${t('accumulated_profit')} (R$)`,
                    data: profitData,
                    borderColor: '#3730a3',
                    backgroundColor: 'rgba(55, 48, 163, 0.08)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3,
                    borderDash: [5, 3]
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) =>
                            context.dataset.label + ': R$ ' + context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 0 })
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: (value) => 'R$ ' + (value / 1000).toFixed(0) + 'k' },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ============================================
// Arbitrage Windows Chart
// ============================================
function initializeArbitrageChart() {
    const ctx = document.getElementById('arbitrageChart');
    if (!ctx) return;

    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

    const sellPrice = hours.map((_, i) => {
        if (i >= 17 && i < 20) return 0.82;
        if ((i >= 6 && i < 17) || (i >= 20 && i < 22)) return 0.45 + Math.random() * 0.1;
        return 0.25;
    });

    const buyPrice = hours.map(() => 0.25);
    const margin = hours.map((_, i) => Math.max(0, sellPrice[i] - 0.25));

    arbitrageChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: hours,
            datasets: [
                {
                    label: `${t('sell')} ${t('price')} (R$/kWh)`,
                    data: sellPrice,
                    backgroundColor: hours.map((_, i) => {
                        if (i >= 17 && i < 20) return 'rgba(220, 38, 38, 0.8)';
                        if ((i >= 6 && i < 17) || (i >= 20 && i < 22)) return 'rgba(217, 119, 6, 0.6)';
                        return 'rgba(5, 150, 105, 0.6)';
                    }),
                    borderRadius: 4,
                    order: 2
                },
                {
                    label: `${t('buy')} ${t('cost')} (R$/kWh)`,
                    data: buyPrice,
                    type: 'line',
                    borderColor: '#64748b',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    order: 1
                },
                {
                    label: `${t('margin')} (R$/kWh)`,
                    data: margin,
                    type: 'line',
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 20 } },
                tooltip: {
                    callbacks: {
                        label: (context) => context.dataset.label + ': R$ ' + context.parsed.y.toFixed(2)
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: (value) => 'R$ ' + value.toFixed(2) },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ============================================
// Revenue Trend (7 days)
// ============================================
function initializeRevenueTrendChart() {
    const ctx = document.getElementById('revenueTrendChart');
    if (!ctx) return;

    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const translatedLabels = weekdays.map(day => t(day));
    const trendData = getRevenueTrend();

    revenueTrendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: translatedLabels,
            datasets: [
                {
                    label: t('gross_revenue'),
                    data: trendData.receita,
                    backgroundColor: 'rgba(55, 48, 163, 0.7)',
                    borderRadius: 6,
                    order: 2
                },
                {
                    label: t('cost'),
                    data: trendData.custo,
                    backgroundColor: 'rgba(220, 38, 38, 0.5)',
                    borderRadius: 6,
                    order: 2
                },
                {
                    label: t('net_profit'),
                    data: trendData.lucro,
                    type: 'line',
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3,
                    pointBackgroundColor: '#059669',
                    pointRadius: 5,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 15 } },
                tooltip: {
                    callbacks: {
                        label: (context) => context.dataset.label + ': R$ ' + context.parsed.y.toLocaleString('pt-BR')
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: (value) => 'R$ ' + (value / 1000).toFixed(0) + 'k' },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ============================================
// Revenue Breakdown (Doughnut)
// ============================================
function initializeRevenueBreakdownChart() {
    const ctx = document.getElementById('revenueBreakdownChart');
    if (!ctx) return;

    const breakdownData = getRevenueBreakdown();

    revenueBreakdownChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [t('tariff_arbitrage'), t('demand_response'), t('ancillary_services')],
            datasets: [{
                data: breakdownData.values,
                backgroundColor: breakdownData.colors,
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((context.parsed / total) * 100).toFixed(1);
                            return context.label + ': R$ ' + context.parsed.toLocaleString('pt-BR') + ' (' + pct + '%)';
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// Public API
// ============================================

export function initAllCharts() {
    initializeRevenueCurveChart();
    initializeArbitrageChart();
    initializeRevenueTrendChart();
    initializeRevenueBreakdownChart();
}

export function updateRevenueCurveChart() {
    if (!revenueCurveChart) return;
    const datasets = revenueCurveChart.data.datasets;
    const hour = new Date().getHours();
    if (hour < 24 && datasets[0].data[hour] !== undefined) {
        datasets[0].data[hour] += Math.random() * 200 - 50;
        if (datasets[0].data[hour] < 0) datasets[0].data[hour] = 0;
    }
    revenueCurveChart.update('none');
}

export function updateChartLabels() {
    if (revenueCurveChart) {
        revenueCurveChart.data.datasets[0].label = `${t('revenue')} (R$)`;
        revenueCurveChart.data.datasets[1].label = `${t('cost')} (R$)`;
        revenueCurveChart.data.datasets[2].label = `${t('accumulated_profit')} (R$)`;
        revenueCurveChart.update();
    }

    if (arbitrageChart) {
        arbitrageChart.destroy();
        arbitrageChart = null;
        initializeArbitrageChart();
    }

    if (revenueTrendChart) {
        const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        revenueTrendChart.data.labels = weekdays.map(day => t(day));
        revenueTrendChart.data.datasets[0].label = t('gross_revenue');
        revenueTrendChart.data.datasets[1].label = t('cost');
        revenueTrendChart.data.datasets[2].label = t('net_profit');
        revenueTrendChart.update();
    }

    if (revenueBreakdownChart) {
        revenueBreakdownChart.data.labels = [t('tariff_arbitrage'), t('demand_response'), t('ancillary_services')];
        revenueBreakdownChart.update();
    }
}

/**
 * Update revenue trend chart with data for different periods
 * @param {number} days - 7, 30, or 90
 */
export function updateRevenueTrendPeriod(days) {
    if (!revenueTrendChart) return;

    const baseData = getRevenueTrend();

    if (days === 7) {
        const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        revenueTrendChart.data.labels = weekdays.map(day => t(day));
        revenueTrendChart.data.datasets[0].data = baseData.receita;
        revenueTrendChart.data.datasets[1].data = baseData.custo;
        revenueTrendChart.data.datasets[2].data = baseData.lucro;
    } else if (days === 30) {
        // Generate 30-day simulated data grouped by weeks
        const labels = ['S1', 'S2', 'S3', 'S4'];
        const receita = baseData.receita.slice(0, 4).map((v, i) => Math.round(v * (6.5 + i * 0.3)));
        const custo = baseData.custo.slice(0, 4).map((v, i) => Math.round(v * (6.5 + i * 0.2)));
        const lucro = receita.map((r, i) => r - custo[i]);

        revenueTrendChart.data.labels = labels;
        revenueTrendChart.data.datasets[0].data = receita;
        revenueTrendChart.data.datasets[1].data = custo;
        revenueTrendChart.data.datasets[2].data = lucro;
    } else if (days === 90) {
        // Generate 90-day data grouped by months
        const monthNames = { zh: ['1月', '2月', '3月'], en: ['Jan', 'Feb', 'Mar'], pt: ['Jan', 'Fev', 'Mar'] };
        const lang = localStorage.getItem('solfacilLanguage') || 'zh';
        const labels = monthNames[lang] || monthNames.pt;
        const receita = [1245000, 1380000, 1520000];
        const custo = [289000, 302000, 318000];
        const lucro = receita.map((r, i) => r - custo[i]);

        revenueTrendChart.data.labels = labels;
        revenueTrendChart.data.datasets[0].data = receita;
        revenueTrendChart.data.datasets[1].data = custo;
        revenueTrendChart.data.datasets[2].data = lucro;
    }

    revenueTrendChart.update();
}
