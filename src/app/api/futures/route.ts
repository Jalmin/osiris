import { NextResponse } from 'next/server';

/**
 * OSIRIS — Futures & term structure (Yahoo Finance chart API, free, no key).
 * Front-month commodity/index futures + the VIX, each geo-anchored to the
 * supply region that drives it, plus a ~6-month curve read (contango vs
 * backwardation) from a dated contract. Backwardation = the market paying a
 * premium for delivery NOW — a physical-tightness signal PYTHIA treats as
 * forward-looking stress.
 */
export const dynamic = 'force-dynamic';

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Curve = { root: string; exch: string; months: number[] };
type Spec = { symbol: string; name: string; unit?: string; region?: string; lat?: number; lng?: number; curve?: Curve };

const FUTURES: Spec[] = [
  { symbol: 'CL=F', name: 'WTI Crude Oil', unit: '$/bbl', region: 'Cushing / US Gulf Coast', lat: 35.98, lng: -96.77, curve: { root: 'CL', exch: 'NYM', months: ALL_MONTHS } },
  { symbol: 'BZ=F', name: 'Brent Crude', unit: '$/bbl', region: 'North Sea', lat: 58.5, lng: 1.5 },
  { symbol: 'NG=F', name: 'Natural Gas (Henry Hub)', unit: '$/MMBtu', region: 'Henry Hub, Louisiana', lat: 29.98, lng: -92.03, curve: { root: 'NG', exch: 'NYM', months: ALL_MONTHS } },
  { symbol: 'GC=F', name: 'Gold', unit: '$/oz', curve: { root: 'GC', exch: 'CMX', months: [2, 4, 6, 8, 10, 12] } },
  { symbol: 'ZW=F', name: 'Wheat (CBOT)', unit: '¢/bu', region: 'Black Sea grain corridor', lat: 46.0, lng: 31.5, curve: { root: 'ZW', exch: 'CBT', months: [3, 5, 7, 9, 12] } },
  { symbol: 'ZC=F', name: 'Corn (CBOT)', unit: '¢/bu', region: 'US Corn Belt', lat: 41.6, lng: -93.6, curve: { root: 'ZC', exch: 'CBT', months: [3, 5, 7, 9, 12] } },
  { symbol: 'ZS=F', name: 'Soybeans (CBOT)', unit: '¢/bu', region: 'US Corn Belt', lat: 41.6, lng: -93.6, curve: { root: 'ZS', exch: 'CBT', months: [1, 3, 5, 7, 8, 9, 11] } },
  { symbol: 'ES=F', name: 'S&P 500 futures', region: 'US markets', lat: 40.71, lng: -74.01 },
  { symbol: 'NQ=F', name: 'Nasdaq 100 futures', region: 'US markets', lat: 40.71, lng: -74.01 },
  { symbol: '^VIX', name: 'VIX fear gauge', region: 'US markets', lat: 41.88, lng: -87.63 },
];

// NOTE: no User-Agent header on purpose — Yahoo 429s "browser" UAs that arrive
// without cookies (bot heuristic), while a plain server-side fetch passes.
async function quote(symbol: string): Promise<{ price: number; change_percent: number } | null> {
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      const prev = meta?.chartPreviousClose || meta?.previousClose;
      if (!price) continue;
      return { price: Math.round(price * 100) / 100, change_percent: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0 };
    } catch { /* try the other host */ }
  }
  return null;
}

// The dated contract ~monthsAhead out, snapped forward to a listed contract month.
function datedContract(c: Curve, monthsAhead: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthsAhead);
  while (!c.months.includes(d.getMonth() + 1)) d.setMonth(d.getMonth() + 1);
  return `${c.root}${MONTH_CODES[d.getMonth()]}${String(d.getFullYear()).slice(2)}.${c.exch}`;
}

// Yahoo throttles bursts (429) — serve the whole read from cache for 5 minutes.
let cache: { ts: number; body: Record<string, unknown> } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.ts < 300_000) return NextResponse.json(cache.body);
  try {
    const rows = await Promise.all(FUTURES.map(async spec => {
      const q = await quote(spec.symbol);
      if (!q) return null;
      const row: Record<string, unknown> = { symbol: spec.symbol, name: spec.name, ...q, up: q.change_percent >= 0 };
      if (spec.unit) row.unit = spec.unit;
      if (spec.region) { row.region = spec.region; row.lat = spec.lat; row.lng = spec.lng; }
      if (spec.curve) {
        const contract = datedContract(spec.curve, 7);
        const far = await quote(contract);
        if (far) {
          const spread = Math.round(((far.price - q.price) / q.price) * 10000) / 100;
          row.curve = {
            far_contract: contract, far_price: far.price, spread_pct: spread,
            structure: spread < -0.5 ? 'backwardation' : spread > 0.5 ? 'contango' : 'flat',
          };
        }
      }
      return row;
    }));
    const futures = rows.filter(Boolean) as Record<string, unknown>[];
    const tight = futures.filter(f => (f.curve as { structure?: string } | undefined)?.structure === 'backwardation').map(f => f.name);
    const summary = tight.length ? `Backwardated (physically tight): ${tight.join(', ')}` : '';
    const body = { futures, summary, timestamp: new Date().toISOString() };
    if (futures.length) cache = { ts: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ futures: [], error: String(e) });
  }
}
