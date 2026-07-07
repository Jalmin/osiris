import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * PYTHIA overlay — proxy vers l'adaptateur `enriched-news` du labo Pythia (T8).
 *
 * L'adaptateur (FastAPI, port interne 8090) enrichit les ~15 événements les
 * plus saillants du brief avec leur texte d'article complet :
 *   - paywall-scraper prod pour Le Monde / Monde Diplo / Alternatives Éco,
 *   - trafilatura pour le reste du web.
 *
 * Dédup par URL en SQLite côté adapter ; le cron 4×/jour (30 min avant chaque
 * passe predict) rafraîchit le JSONL du jour. Ici on ne fait que servir tel
 * quel — l'intake Pythia normalise via `_to_event` (title/summary/url/risk_score).
 *
 * ADAPTER_URL n'est résolvable QUE dans le réseau docker compose du labo —
 * la variable d'env doit être posée sur le service osiris du compose.
 */
export async function GET(request: Request) {
  const base = process.env.ADAPTER_URL ?? 'http://adapter:8090';
  const inUrl = new URL(request.url);
  const day = inUrl.searchParams.get('day');
  const target = day ? `${base}/api/enriched-news?day=${encodeURIComponent(day)}` : `${base}/api/enriched-news`;

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
