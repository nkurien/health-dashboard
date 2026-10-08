"use client";

import type { ReactNode } from "react";
import type { Person, UserMetrics } from "@/lib/types";

/** One metric card: a title, then each person side by side in the same row. */
export default function Section({
  icon,
  title,
  hint,
  people,
  isLoading,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  people: Person[];
  isLoading: boolean;
  children: (m: UserMetrics, p: Person) => ReactNode;
}) {
  return (
    <section className="row-card" aria-label={title}>
      <div className="row-head">
        <h2>
          {icon}
          {title}
        </h2>
        <span className="hint">{hint}</span>
      </div>
      <div className="pair">
        {people.map((p) => (
          <div key={p.id} className="person" data-who={p.id}>
            <div className="who">
              <span className="dot" aria-hidden />
              {p.name}
              {p.metrics?.is_mock && <span className="badge">Sample data</span>}
            </div>
            {isLoading || !p.metrics ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <div className="skeleton" style={{ height: 40, width: "45%" }} />
                <div className="skeleton" style={{ height: 14, width: "70%" }} />
                <div className="skeleton" style={{ height: 64 }} />
              </div>
            ) : (
              children(p.metrics, p)
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
