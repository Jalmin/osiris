import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * PYTHIA overlay — proxy vers l'adaptateur `brief-matinal` du labo Pythia (T4).
 *
 * L'adaptateur (FastAPI, port interne 8090) lit les JSONL du scraper prod
 * `brief-matinal` (rsync quotidien à 6h15) et sert /api/local-news au format
 * qu'osiris_intake.py normalise déjà. La salience FR est portée par
 * `risk_score` (0-100), honoré nativement par l'intake Pythia.
 *
 * ADAPTER_URL n'est résolvable QUE dans le réseau docker compose du labo —
 * la variable d'env doit être posée sur le service osiris du compose.
 */
export async function GET(request: Request) {
  const base = process.env.ADAPTER_URL ?? 'http://adapter:8090';
  const inUrl = new URL(request.url);
  const day = inUrl.searchParams.get('day');
  const target = day ? `${base}/api/local-news?day=${encodeURIComponent(day)}` : `${base}/api/local-news`;

  try {
    const r = await fetch(target, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!r.ok) {
      return NextResponse.json({ articles: [], error: `adapter ${r.status}` }, { status: 502 });
    }
    const j = await r.json();
    return NextResponse.json(j, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'adapter fetch failed';
    return NextResponse.json({ articles: [], error: msg }, { status: 502 });
  }
}
