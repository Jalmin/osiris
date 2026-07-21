import { NextResponse } from 'next/server';

/**
 * OSIRIS — FMP Stock News (falsifiable finance events)
 *
 * Source: Financial Modeling Prep `/news/stock-latest` (~20 latest articles).
 * Fields observed: symbol, publishedDate, publisher, title, image, site, text, url.
 * (No `content` field — the body lives in `text`.)
 *
 * FILTERING: light. The endpoint already returns a small, curated latest set,
 * so we just take the top 20 as-is (no country/impact firehose to tame here).
 *
 * Output contract for the Pythia engine:
 *   [{ title, description, url, date, risk_score }]
 *   - title:       the article title
 *   - description: "[SYMBOL] " + article text, truncated to ~500 chars
 *   - url:         article url
 *   - date:        ISO publishedDate
 *   - risk_score:  65 (news signal — informative but noisier than scheduled events)
 */

const FMP_BASE = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable';

const RISK_SCORE_NEWS = 65;
const MAX_ARTICLES = 20;
const MAX_DESC_CHARS = 500;

interface FmpNews {
  symbol?: string;
  publishedDate: string;
  publisher?: string;
  title: string;
  image?: string;
  site?: string;
  text?: string;
  url?: string;
}

interface EngineEvent {
  title: string;
  description: string;
  url: string;
  date: string;
  risk_score: number;
}

function toIso(date: string): string {
  const d = new Date(date.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? date : d.toISOString();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

export async function GET() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json([]);
  }

  try {
    const url = `${FMP_BASE}/news/stock-latest?apikey=${apiKey}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 900 }, // news moves faster; refresh every 15 min
    });

    if (!res.ok) {
      console.error(`FMP news/stock-latest responded with ${res.status}`);
      return NextResponse.json([]);
    }

    const data: FmpNews[] = await res.json();
    if (!Array.isArray(data)) return NextResponse.json([]);

    const events: EngineEvent[] = data
      .slice(0, MAX_ARTICLES)
      .map((n) => {
        const body = n.text ? n.text : '';
        const prefix = n.symbol ? `[${n.symbol}] ` : '';
        return {
          title: n.title,
          description: truncate(prefix + body, MAX_DESC_CHARS),
          url: n.url || '',
          date: toIso(n.publishedDate),
          risk_score: RISK_SCORE_NEWS,
        };
      });

    return NextResponse.json(events);
  } catch (error) {
    console.error('FMP news/stock-latest fetch error:', error);
    return NextResponse.json([]);
  }
}
