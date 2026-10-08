"use client";

import { Link2, Unlink } from "lucide-react";
import type { AuthStatus, Person, UserId } from "@/lib/types";
import { disconnectUser, loginUrl } from "@/lib/api";

export default function PeopleStrip({
  people,
  status,
  onChange,
}: {
  people: Person[];
  status: AuthStatus | null;
  onChange: () => void;
}) {
  return (
    <div className="people-strip">
      {people.map((p) => {
        const info = status?.[p.id];
        const connected = !!info?.connected;
        return (
          <div key={p.id} className="chip" data-who={p.id}>
            <span className="dot" aria-hidden />
            <div className="text">
              <b>{p.name}</b>
              <span>
                {connected ? (info?.email ?? "Connected") : "Not connected yet — showing sample data"}
              </span>
            </div>
            {connected ? (
              <button
                className="btn"
                aria-label={`Disconnect ${p.name}`}
                onClick={async () => {
                  await disconnectUser(p.id as UserId);
                  onChange();
                }}
              >
                <Unlink size={13} aria-hidden /> Disconnect
              </button>
            ) : (
              <a className="btn" id={`connect-${p.id}`} href={loginUrl(p.id)} aria-label={`Connect ${p.name}`}>
                <Link2 size={13} aria-hidden /> Connect
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
