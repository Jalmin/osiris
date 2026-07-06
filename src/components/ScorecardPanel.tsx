'use client';

/** PYTHIA's track record — the receipts.
 *  Brier score + hit rate, calibration (predicted vs observed), per-horizon /
 *  per-persona / per-model accuracy, and the most recent judged forecasts.
 *  Data: /api/engine/scorecard (graded by an LLM judge as horizons expire). */
import { useEffect, useState } from 'react';
import { Target, Loader2 } from 'lucide-react';

type Cal = { bin: string; n: number; avg_predicted: number; observed: number };
type Rec = { statement: string; horizon: string; probability: number; outcome: number; verdict: string; evidence?: string; location?: string };
type Score = {
  resolved: number; open: number; due: number; unresolvable: number;
  brier: number | null; hit_rate: number | null;
  per_horizon: Record<string, { resolved: number; brier: number; hit_rate: number }>;
  calibration: Cal[];
  personas: Record<string, { resolved: number; brier: number }>;
  models: Record<string, { resolved: number; brier: number }>;
  recent: Rec[];
};

const HCOLOR: Record<string, string> = {
  '24h': 'var(--alert-red)', week: 'var(--gold-primary)', month: 'var(--cyan-primary)', year: 'var(--text-secondary)',
};

function brierColor(b: number | null): string {
  if (b == null) return 'var(--text-muted)';
  return b <= 0.15 ? 'var(--cyan-primary)' : b <= 0.25 ? 'var(--gold-primary)' : 'var(--alert-red)';
}

function ScoreTable({ title, rows }: { title: string; rows: Array<[string, { resolved: number; brier: number }]> }) {
  if (!rows.length) return null;
  const best = Math.min(...rows.map(([, s]) => s.brier));
  return (
    <div className="mb-2">
      <div className="text-[8px] font-mono tracking-widest text-[var(--text-muted)] mb-1">{title}</div>
      {rows.sort((a, b) => a[1].brier - b[1].brier).map(([name, s]) => (
        <div key={name} className="flex items-center gap-2 text-[9px] font-mono py-0.5">
          <span className="w-[120px] truncate text-[var(--text-secondary)]">{s.brier === best && rows.length > 1 ? '👑 ' : ''}{name}</span>
          <div className="flex-1 h-1 rounded-full bg-[var(--hover-accent)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(4, 100 - s.brier * 200)}%`, background: brierColor(s.brier) }} />
          </div>
          <span style={{ color: brierColor(s.brier) }}>{s.brier.toFixed(3)}</span>
          <span className="text-[var(--text-muted)]">n={s.resolved}</span>
        </div>
      ))}
    </div>
  );
}

export default function ScorecardPanel() {
  const [d, setD] = useState<Score | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/engine/scorecard');
        if (r.ok) { const j = await r.json(); if (!stop) setD(j); }
      } catch { /* engine offline */ }
      if (!stop) setLoading(false);
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { stop = true; clearInterval(iv); };
  }, []);

  if (loading && !d) return <div className="py-4 text-center"><Loader2 className="w-3.5 h-3.5 animate-spin inline text-[var(--text-muted)]" /></div>;
  if (!d) return null;

  return (
    <div className="mt-2 mb-1 rounded-lg border border-[var(--border-secondary)] p-2.5" style={{ background: 'rgba(255,255,255,.02)' }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Target className="w-3 h-3" style={{ color: 'var(--gold-primary)' }} />
        <span className="text-[9px] font-mono tracking-widest text-[var(--text-secondary)]">TRACK RECORD</span>
        <span className="text-[8px] font-mono text-[var(--text-muted)] ml-auto">{d.resolved} resolved · {d.open} open{d.due ? ` · ${d.due} due` : ''}</span>
      </div>

      {d.resolved === 0 ? (
        <div className="text-[9px] font-mono text-[var(--text-muted)] leading-relaxed py-2">
          No resolved forecasts yet. Every prediction goes on the record when it&apos;s made;
          an LLM judge grades it against the archived world once its horizon expires
          (24h forecasts resolve after a day). The receipts land here.
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="flex items-end gap-4 mb-2">
            <div>
              <div className="text-[22px] font-mono font-bold leading-none" style={{ color: brierColor(d.brier) }}>{d.brier?.toFixed(3) ?? '—'}</div>
              <div className="text-[7px] font-mono text-[var(--text-muted)] mt-0.5" title="Mean squared error of resolved forecasts">BRIER · 0=prophecy · .25=coin-flip</div>
            </div>
            <div>
              <div className="text-[15px] font-mono font-bold leading-none text-[var(--text-primary)]">{d.hit_rate != null ? `${Math.round(d.hit_rate * 100)}%` : '—'}</div>
              <div className="text-[7px] font-mono text-[var(--text-muted)] mt-0.5">CALLS RIGHT</div>
            </div>
          </div>

          {/* Calibration: predicted (x) vs observed (y) */}
          {d.calibration.length > 0 && (
            <div className="mb-2">
              <div className="text-[8px] font-mono tracking-widest text-[var(--text-muted)] mb-1"
                title="Dots on the diagonal = perfectly calibrated. Above = things happen more often than predicted; below = less.">CALIBRATION</div>
              <svg viewBox="0 0 100 56" className="w-full" style={{ maxHeight: 90 }}>
                <line x1="8" y1="48" x2="96" y2="48" stroke="var(--border-secondary)" strokeWidth="0.6" />
                <line x1="8" y1="48" x2="8" y2="4" stroke="var(--border-secondary)" strokeWidth="0.6" />
                <line x1="8" y1="48" x2="96" y2="4" stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
                {d.calibration.map((c) => (
                  <circle key={c.bin} cx={8 + c.avg_predicted * 88} cy={48 - c.observed * 44}
                    r={Math.min(4.5, 1.5 + Math.sqrt(c.n))} fill="var(--gold-primary)" opacity="0.8">
                    <title>{c.bin}: predicted {Math.round(c.avg_predicted * 100)}%, happened {Math.round(c.observed * 100)}% (n={c.n})</title>
                  </circle>
                ))}
                <text x="8" y="54" fontSize="4.5" fill="var(--text-muted)" fontFamily="monospace">0%</text>
                <text x="88" y="54" fontSize="4.5" fill="var(--text-muted)" fontFamily="monospace">100%</text>
              </svg>
            </div>
          )}

          {/* Per horizon */}
          {Object.keys(d.per_horizon).length > 0 && (
            <div className="mb-2">
              <div className="text-[8px] font-mono tracking-widest text-[var(--text-muted)] mb-1">BY HORIZON</div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(d.per_horizon).map(([h, s]) => (
                  <span key={h} className="text-[9px] font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: HCOLOR[h] || 'var(--text-muted)' }} />
                    <span style={{ color: HCOLOR[h] }}>{h}</span>
                    <span style={{ color: brierColor(s.brier) }}>{s.brier.toFixed(2)}</span>
                    <span className="text-[var(--text-muted)]">n={s.resolved}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <ScoreTable title="THE COUNCIL (Brier per persona — weights their votes)" rows={Object.entries(d.personas)} />
          <ScoreTable title="MODEL BAKE-OFF (Brier per local model)" rows={Object.entries(d.models)} />

          {/* Recent verdicts */}
          {d.recent.length > 0 && (
            <div>
              <div className="text-[8px] font-mono tracking-widest text-[var(--text-muted)] mb-1">RECENT VERDICTS</div>
              {d.recent.slice(0, 8).map((r, i) => (
                <div key={i} className="text-[9px] font-mono py-0.5 flex items-start gap-1.5" title={r.evidence || ''}>
                  <span style={{ color: r.outcome >= 0.5 ? 'var(--cyan-primary)' : 'var(--alert-red)' }}>
                    {(r.probability >= 0.5) === (r.outcome >= 0.5) ? '✓' : '✗'}
                  </span>
                  <span className="text-[var(--text-secondary)] leading-snug flex-1">
                    <span style={{ color: HCOLOR[r.horizon] }}>[{r.horizon}]</span> {Math.round(r.probability * 100)}% — {r.statement.slice(0, 90)}{r.statement.length > 90 ? '…' : ''}
                    <span className="text-[var(--text-muted)]"> → {r.outcome >= 0.5 ? 'HAPPENED' : 'DID NOT'}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
