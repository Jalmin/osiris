import { NextResponse } from 'next/server';

/**
 * OSIRIS — FMP Economic Calendar (falsifiable finance events)
 *
 * Source: Financial Modeling Prep `/economic-calendar` (~7000 events, firehose).
 * We aggressively filter down to macro-moving events only:
 *   - impact === "High"           (values observed: "Low" | "Medium" | "High")
 *   - country in MAJOR_COUNTRIES  (values are ISO-2-ish: US, EU, CN, JP, DE, FR, UK/GB, CA, AU...)
 *
 * NOTE on country codes: FMP returns "UK" (not "GB") and "EU" (not "EA").
 * We accept both spellings so the list is robust.
 *
 * Output contract for the Pythia engine:
 *   [{ title, description, url, date, risk_score }]
 *   - title:       "US: Fed Interest Rate Decision"
 *   - description: previous / estimate / actual + unit
 *   - url:         "" (FMP economic-calendar exposes no per-event URL)
 *   - date:        ISO date of the event
 *   - risk_score:  80 (all rows are High-impact macro → high salience)
 */

const FMP_BASE = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable';

// Major economies only. FMP uses UK (not GB) and EU (not EA); we accept both.
const MAJOR_COUNTRIES = new Set(['US', 'EU', 'EA', 'CN', 'GB', 'UK', 'JP', 'DE', 'FR']);

const RISK_SCORE_HIGH_IMPACT = 80;

interface FmpEconEvent {
  date: string;
  country: string;
  event: string;
  currency?: string;
  previous?: number | null;
  estimate?: number | null;
  actual?: number | null;
  impact?: string;
  unit?: string;
}

interface EngineEvent {
  title: string;
  description: string;
  url: string;
  date: string;
  risk_score: number;
}

function toIso(date: string): string {
  // FMP dates look like "2026-07-17 14:00:00" (UTC). Normalise to ISO.
  const d = new Date(date.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? date : d.toISOString();
}

function buildDescription(e: FmpEconEvent): string {
  const unit = e.unit ? ` ${e.unit}` : '';
  const parts: string[] = [];
  if (e.actual !== null && e.actual !== undefined) parts.push(`Actual: ${e.actual}${unit}`);
  if (e.estimate !== null && e.estimate !== undefined) parts.push(`Estimate: ${e.estimate}${unit}`);
  if (e.previous !== null && e.previous !== undefined) parts.push(`Previous: ${e.previous}${unit}`);
  return parts.join(' | ');
}

export async function GET() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    // No key configured → degrade cleanly, never crash the engine.
    return NextResponse.json([]);
  }

  try {
    const url = `${FMP_BASE}/economic-calendar?apikey=${apiKey}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 3600 }, // macro calendar is stable; refresh hourly
    });

    if (!res.ok) {
      console.error(`FMP economic-calendar responded with ${res.status}`);
      return NextResponse.json([]);
    }

    const data: FmpEconEvent[] = await res.json();
    if (!Array.isArray(data)) return NextResponse.json([]);

    const events: EngineEvent[] = data
      .filter((e) => e.impact === 'High' && MAJOR_COUNTRIES.has((e.country || '').toUpperCase()))
      .map((e) => ({
        title: `${e.country}: ${e.event}`,
        description: buildDescription(e),
        url: '',
        date: toIso(e.date),
        risk_score: RISK_SCORE_HIGH_IMPACT,
      }));

    return NextResponse.json(events);
  } catch (error) {
    console.error('FMP economic-calendar fetch error:', error);
    return NextResponse.json([]);
  }
}
