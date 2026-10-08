"use client";

import { Footprints, HeartPulse, Leaf, Moon } from "lucide-react";
import type { Person } from "@/lib/types";
import { RECOVERY_WORDS, fillDays, fmtDuration, whyLines } from "@/lib/format";
import Section from "./Section";
import { DayBars, Gauge, Sparkline, StageBar } from "./charts";

interface RowProps {
  people: Person[];
  isLoading: boolean;
}

const ICON = { size: 20, strokeWidth: 1.8, "aria-hidden": true } as const;

export function RecoveryRow({ people, isLoading }: RowProps) {
  return (
    <Section
      icon={<Leaf {...ICON} />}
      title="Recovery"
      hint="each person compared with their own normal"
      people={people}
      isLoading={isLoading}
    >
      {(m) => {
        const r = m.readiness;
        const why = whyLines(r.components);
        return (
          <div>
            <Gauge value={r.score}>
              <div className="big">{r.score ?? "—"}</div>
            </Gauge>
            <div className="recovery-word">{RECOVERY_WORDS[r.label]}</div>
            {r.score === null ? (
              <div className="why">Appears once today’s HRV has synced after waking.</div>
            ) : (
              <div className="why">{why.join(" · ")}</div>
            )}
          </div>
        );
      }}
    </Section>
  );
}

export function SleepRow({ people, isLoading }: RowProps) {
  return (
    <Section
      icon={<Moon {...ICON} />}
      title="Sleep"
      hint="last night, and the past week"
      people={people}
      isLoading={isLoading}
    >
      {(m) => {
        const s = m.sleep;
        if (m.errors.sleep || s.total_minutes == null) {
          return <p className="note-err">Couldn’t load sleep. {m.errors.sleep}</p>;
        }
        const asleep = s.total_minutes - s.stages.wake;
        const series = fillDays(s.series ?? []) as Array<{ date: string; asleep_minutes?: number }>;
        return (
          <div>
            <div className="big">{fmtDuration(asleep)}</div>
            <div className="caption">asleep · {s.efficiency_pct}% of the night in bed</div>
            <StageBar stages={s.stages} fmt={fmtDuration} />
            {series.length > 1 && (
              <div className="sub">
                <div className="sub-label">Past 7 nights · dashed line is 7½h</div>
                <DayBars
                  data={series}
                  valueKey="asleep_minutes"
                  format={(row) => (row.asleep_minutes == null ? "no sleep recorded" : fmtDuration(Number(row.asleep_minutes)))}
                  reference={{ value: 450 }}
                />
              </div>
            )}
          </div>
        );
      }}
    </Section>
  );
}

function usualWords(today: number | null, avg: number | null, unit: string, threshold: number, digits = 0) {
  if (today == null || avg == null) return null;
  const diff = today - avg;
  if (Math.abs(diff) < threshold) return "about your usual";
  return `${Math.abs(diff).toFixed(digits)} ${unit} ${diff < 0 ? "lower" : "higher"} than usual`;
}

export function HeartRow({ people, isLoading }: RowProps) {
  return (
    <Section
      icon={<HeartPulse {...ICON} />}
      title="Heart"
      hint="resting heart rate and HRV, past 7 days"
      people={people}
      isLoading={isLoading}
    >
      {(m) => {
        const h = m.heart;
        return (
          <div>
            <div className="sub-label">Resting heart rate</div>
            <div className="big">
              {h.rhr_today != null ? h.rhr_today.toFixed(0) : "—"}
              <small>bpm</small>
            </div>
            <div className="caption">{usualWords(h.rhr_today, h.rhr_7d_avg, "bpm", 1) ?? "no reading yet"}</div>
            {h.rhr_series.length > 1 && (
              <Sparkline
                data={h.rhr_series}
                valueKey="rhr"
                format={(row) => `${row.rhr} bpm`}
              />
            )}

            <div className="sub">
              <div className="sub-label">Heart rate variability</div>
              <div className="big">
                {h.hrv_today != null ? h.hrv_today.toFixed(0) : "—"}
                <small>ms</small>
              </div>
              <div className="caption">{usualWords(h.hrv_today, h.hrv_7d_avg, "ms", 1.5) ?? "not synced yet today"}</div>
              {h.hrv_series.length > 1 && (
                <Sparkline
                  data={h.hrv_series}
                  valueKey="rmssd"
                  format={(row) => `${row.rmssd} ms`}
                />
              )}
            </div>
          </div>
        );
      }}
    </Section>
  );
}

export function StepsRow({ people, isLoading }: RowProps) {
  return (
    <Section
      icon={<Footprints {...ICON} />}
      title="Steps"
      hint="today so far, and the past week"
      people={people}
      isLoading={isLoading}
    >
      {(m) => {
        const s = m.steps;
        if (m.errors.steps || s.steps == null) {
          return <p className="note-err">Couldn’t load steps. {m.errors.steps}</p>;
        }
        const pct = Math.min(100, Math.round((s.steps / s.goal) * 100));
        return (
          <div>
            <div className="big">
              {s.steps.toLocaleString()}
              <small>/ {s.goal.toLocaleString()}</small>
            </div>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to daily step goal">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="caption">{pct >= 100 ? "Goal reached 🎉" : `${pct}% of the daily goal`}</div>
            {s.series && s.series.length > 1 && (
              <div className="sub">
                <div className="sub-label">Past 7 days · dashed line is the goal</div>
                <DayBars
                  data={s.series}
                  valueKey="steps"
                  format={(row) => `${Number(row.steps).toLocaleString()} steps`}
                  reference={{ value: s.goal }}
                />
              </div>
            )}
          </div>
        );
      }}
    </Section>
  );
}
