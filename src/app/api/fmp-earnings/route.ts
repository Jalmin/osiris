import { NextResponse } from 'next/server';

/**
 * OSIRIS — FMP Earnings Calendar (falsifiable finance events)
 *
 * Source: Financial Modeling Prep `/earnings-calendar` (~4000 rows, firehose).
 * Fields observed: symbol, date, epsActual, epsEstimated, revenueActual,
 *                  revenueEstimated, lastUpdated.
 *
 * FILTERING — the raw feed is dominated by foreign micro-caps with exotic
 * suffixes (`.NS` India, `.L` London, `.ST` Stockholm, `.PA` Paris, `.BK`,
 * `.BO`, `.TO`, `.SW`, `.VI`, `.KW`...) plus US OTC/ADR pink sheets (5-letter
 * tickers ending in F = foreign ordinary, Y = ADR).
 *
 * There is NO market-cap / size field in this endpoint, so "big cap" cannot be
 * filtered directly. We approximate a clean US-listed universe with a symbol
 * heuristic:
 *   - keep only `^[A-Z]{1,5}$` (pure alpha, 1-5 chars, no dot suffix, no digits)
 *   - drop 5-letter symbols ending in F or Y (classic OTC/ADR convention)
 * This keeps NYSE/Nasdaq listings (incl. megacaps like GOOGL) while cutting the
 * foreign + pink-sheet noise. Documented as a heuristic, not a guarantee.
 *
 * Output contract for the Pythia engine:
 *   [{ title, description, url, date, risk_score }]
 *   - title:       "DPZ earnings (2026-07-20)"
 *   - description: EPS estimate/actual + revenue estimate/actual
 *   - url:         "" (endpoint exposes no per-event URL)
 *   - date:        ISO date of the earnings event
 *   - risk_score:  70 (scheduled, market-moving for the ticker)
 */

const FMP_BASE = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable';

const RISK_SCORE_EARNINGS = 70;

// Clean US-listed common stock: 1-5 uppercase letters, no suffix, no digits.
const CLEAN_TICKER = /^[A-Z]{1,5}$/;
// OTC/ADR pink-sheet convention: 5-letter ending in F (foreign) or Y (ADR).
const OTC_SUFFIX = /^[A-Z]{4}[FY]$/;

interface FmpEarning {
  symbol: string;
  date: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
}

interface EngineEvent {
  title: string;
  description: string;
  url: string;
  date: string;
  risk_score: number;
}

function toIso(date: string): string {
  const d = new Date(date.length <= 10 ? `${date}T00:00:00Z` : date.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? date : d.toISOString();
}

function fmtRevenue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v}`;
}

function buildDescription(e: FmpEarning): string {
  const parts: string[] = [];
  if (e.epsEstimated !== null && e.epsEstimated !== undefined) parts.push(`EPS est. ${e.epsEstimated}`);
  if (e.epsActual !== null && e.epsActual !== undefined) parts.push(`EPS actual ${e.epsActual}`);
  if (e.revenueEstimated !== null && e.revenueEstimated !== undefined) parts.push(`Rev est. ${fmtRevenue(e.revenueEstimated)}`);
  if (e.revenueActual !== null && e.revenueActual !== undefined) parts.push(`Rev actual ${fmtRevenue(e.revenueActual)}`);
  return parts.join(' | ');
}

function isCleanUsTicker(symbol: string): boolean {
  if (!symbol) return false;
  return CLEAN_TICKER.test(symbol) && !OTC_SUFFIX.test(symbol);
}

export async function GET() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json([]);
  }

  try {
    const url = `${FMP_BASE}/earnings-calendar?apikey=${apiKey}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 3600 }, // earnings schedule is stable intraday
    });

    if (!res.ok) {
      console.error(`FMP earnings-calendar responded with ${res.status}`);
      return NextResponse.json([]);
    }

    const data: FmpEarning[] = await res.json();
    if (!Array.isArray(data)) return NextResponse.json([]);

    const events: EngineEvent[] = data
      .filter((e) => isCleanUsTicker(e.symbol))
      .map((e) => ({
        title: `${e.symbol} earnings (${e.date})`,
        description: buildDescription(e),
        url: '',
        date: toIso(e.date),
        risk_score: RISK_SCORE_EARNINGS,
      }));

    return NextResponse.json(events);
  } catch (error) {
    console.error('FMP earnings-calendar fetch error:', error);
    return NextResponse.json([]);
  }
}
