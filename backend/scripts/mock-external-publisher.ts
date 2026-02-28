/**
 * Mock External Publisher — v5.7
 * Simulates CCEE power exchange and weather bureau pushing dynamic data to M7 Webhooks.
 *
 * Usage (standalone, does not affect main server):
 *   npx ts-node backend/scripts/mock-external-publisher.ts
 *
 * Effect:
 *   - Pushes CCEE PLD price every 30s (with ±15% random fluctuation)
 *   - Pushes weather data every 90s (irradiance varies randomly)
 *   - Updates pld_horario / weather_cache so M2 Scheduler reads fresh data
 */

const BASE_URL    = process.env.BFF_URL ?? 'http://localhost:3000';
const WH_SECRET   = process.env.WEBHOOK_SECRET ?? 'dev-secret-2026';
const PLD_INTERVAL_MS     = 30_000;   // 30s
const WEATHER_INTERVAL_MS = 90_000;   // 90s

// Base prices per submarket (R$/MWh)
const BASE_PLD: Record<string, number> = {
  SUDESTE:  280,
  SUL:      272,
  NORDESTE: 297,
  NORTE:    305,
};

// Price varies by time of day: off-peak low, peak high
function currentHourPld(submercado: string): number {
  const hour = new Date().getHours();
  const base = BASE_PLD[submercado] ?? 280;
  let multiplier: number;

  if (hour >= 0 && hour < 5) {
    multiplier = 0.40 + Math.random() * 0.20;   // off-peak: 40-60%
  } else if (hour >= 17 && hour < 21) {
    multiplier = 1.50 + Math.random() * 0.50;   // peak: 150-200%
  } else {
    multiplier = 0.80 + Math.random() * 0.40;   // normal: 80-120%
  }

  return Math.round(base * multiplier * 100) / 100;
}

async function pushCceePld(): Promise<void> {
  const now = new Date();
  const results: string[] = [];

  for (const submercado of ['SUDESTE', 'SUL', 'NORDESTE', 'NORTE']) {
    const price = currentHourPld(submercado);
    const payload = {
      mes_referencia: now.getFullYear() * 100 + (now.getMonth() + 1),
      dia:            now.getDate(),
      hora:           now.getHours(),
      submercado,
      price_brl_mwh:  price,
      published_at:   now.toISOString(),
    };

    try {
      const res = await fetch(`${BASE_URL}/webhooks/ccee-pld`, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'x-webhook-secret': WH_SECRET,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json() as Record<string, unknown>;
      if (res.ok) {
        results.push(`${submercado}=R$${price}`);
      } else {
        console.error(`[MockPublisher] PLD ${submercado} error:`, json);
      }
    } catch (err) {
      console.error(`[MockPublisher] PLD ${submercado} fetch failed:`, err);
    }
  }

  console.log(`[MockPublisher][${new Date().toISOString()}] PLD pushed: ${results.join(', ')}`);
}

async function pushWeather(): Promise<void> {
  const now = new Date();
  const locations = ['SP', 'RJ', 'MG', 'PR'];

  for (const loc of locations) {
    const hour = now.getHours();
    const irradiance = hour >= 6 && hour <= 18
      ? Math.round((400 + Math.random() * 400) * 10) / 10
      : 0;

    const payload = {
      location:       loc,
      forecast_time:  now.toISOString(),
      temperature_c:  Math.round((22 + Math.random() * 12) * 10) / 10,
      irradiance_w_m2: irradiance,
      cloud_cover_pct: Math.round(Math.random() * 80),
      source: 'mock-weather-publisher',
    };

    try {
      await fetch(`${BASE_URL}/webhooks/weather`, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'x-webhook-secret': WH_SECRET,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error(`[MockPublisher] Weather ${loc} fetch failed:`, err);
    }
  }

  console.log(`[MockPublisher][${new Date().toISOString()}] Weather pushed: ${locations.join(', ')}`);
}

// Start
console.log('[MockPublisher] Starting — pushing to', BASE_URL);
console.log(`  CCEE PLD:  every ${PLD_INTERVAL_MS / 1000}s`);
console.log(`  Weather:   every ${WEATHER_INTERVAL_MS / 1000}s`);

// Push once immediately
void pushCceePld();
void pushWeather();

// Periodic push
setInterval(() => void pushCceePld(),   PLD_INTERVAL_MS);
setInterval(() => void pushWeather(),   WEATHER_INTERVAL_MS);
