"use client";

import {
  Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { weekdayShort } from "@/lib/format";

/* Colours come from CSS variables so light/dark and per-person accents just work. */
const C = "var(--c)";
const AXIS = { fill: "var(--ink-3)", fontSize: 11 };

type TipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Record<string, unknown>; value?: unknown }>;
};

function ChartTip({
  active,
  payload,
  format,
}: TipProps & { format: (row: Record<string, unknown>) => string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  if (!row) return null;
  return (
    <div className="tip">
      <span>{weekdayShort(String(row.date))}</span>
      {format(row)}
    </div>
  );
}

/** Semicircle gauge. `value` 0–100. */
export function Gauge({ value, children }: { value: number | null; children: React.ReactNode }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="gauge" role="img" aria-label={value === null ? "No score yet" : `Score ${value} out of 100`}>
      <svg viewBox="0 0 160 90">
        <path className="track" d="M 12 82 A 68 68 0 0 1 148 82" fill="none" strokeWidth="12" strokeLinecap="round" pathLength={100} />
        {value !== null && (
          <path
            className="fill"
            d="M 12 82 A 68 68 0 0 1 148 82"
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${v} 100`}
          />
        )}
      </svg>
      <div className="centre">{children}</div>
    </div>
  );
}

const STAGES = [
  { key: "deep", label: "Deep", color: "var(--deep)" },
  { key: "rem", label: "REM", color: "var(--rem)" },
  { key: "light", label: "Light", color: "var(--light)" },
  { key: "wake", label: "Awake", color: "var(--awake)" },
] as const;

export function StageBar({
  stages,
  fmt,
}: {
  stages: Record<"deep" | "rem" | "light" | "wake", number>;
  fmt: (m: number) => string;
}) {
  const total = STAGES.reduce((s, k) => s + stages[k.key], 0);
  if (total <= 0) return null;
  return (
    <>
      <div className="stagebar" role="img" aria-label={STAGES.map((s) => `${s.label} ${fmt(stages[s.key])}`).join(", ")}>
        {STAGES.map((s) => (
          <span
            key={s.key}
            title={`${s.label} ${fmt(stages[s.key])}`}
            style={{ width: `${(stages[s.key] / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="legend">
        {STAGES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label} {fmt(stages[s.key])}
          </span>
        ))}
      </div>
    </>
  );
}

/** Seven-day bars; the latest day is solid, earlier days softer. Optional dashed reference line. */
export function DayBars({
  data,
  valueKey,
  format,
  reference,
  height = 84,
}: {
  data: Array<Record<string, unknown> & { date: string }>;
  valueKey: string;
  format: (row: Record<string, unknown>) => string;
  reference?: { value: number };
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
          <XAxis dataKey="date" tickFormatter={weekdayShort} tick={AXIS} axisLine={false} tickLine={false} interval={0} />
          <YAxis hide domain={[0, (max: number) => Math.max(max, reference?.value ?? 0) * 1.1]} />
          <Tooltip content={(p) => <ChartTip {...(p as TipProps)} format={format} />} cursor={{ fill: "var(--surface-2)", opacity: 0.7 }} />
          {reference && (
            <ReferenceLine y={reference.value} stroke="var(--ink-3)" strokeDasharray="4 4" />
          )}
          <Bar dataKey={valueKey} radius={[5, 5, 0, 0]} isAnimationActive={false}>
            {data.map((_, i) => (
              <Cell key={i} fill={C} fillOpacity={i === data.length - 1 ? 1 : 0.38} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({
  data,
  valueKey,
  format,
  height = 46,
}: {
  data: Array<Record<string, unknown> & { date: string }>;
  valueKey: string;
  format: (row: Record<string, unknown>) => string;
  height?: number;
}) {
  const last = data.length - 1;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip content={(p) => <ChartTip {...(p as TipProps)} format={format} />} cursor={{ stroke: "var(--line)" }} />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke={C}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; index?: number }) =>
              p.index === last && p.cx !== undefined ? (
                <circle key="last" cx={p.cx} cy={p.cy} r={4.5} fill={C} stroke="var(--surface)" strokeWidth={2} />
              ) : (
                <g key={p.index} />
              )
            }
            activeDot={{ r: 4.5, fill: C, stroke: "var(--surface)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
