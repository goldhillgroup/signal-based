"use client";

import { useSyncExternalStore } from "react";
import type { Exportable } from "./csv-export";
import type { Company } from "./company";

/**
 * Notes and grades for every lead.
 *
 * ONE COPY, SHARED. This was a per-component useState + fetch, which was fine
 * while only the export button read it. It is now read by the lead list, the
 * table, and the drawer at the same time, and three components each holding
 * their own copy means three requests for the same 450 short strings and, far
 * worse, three answers: saving a grade in the drawer left the card behind it
 * still showing the system's, until the page was reloaded.
 *
 * A module-level cache with subscribers fixes both. `setLocalMark` is what the
 * drawer calls after a successful save, so the list updates in the same frame
 * as the panel that changed it -- no refetch, no reload.
 */

export interface Mark {
  note: string | null;
  grade: number | null;
}
export type Marks = Record<string, Mark>;

// Stable identity for the server snapshot. Returning a fresh {} each call
// makes useSyncExternalStore loop forever.
const EMPTY: Marks = {};

let cache: Marks = EMPTY;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function load() {
  if (started) return;
  started = true;
  fetch("/api/marks")
    .then((r) => r.json())
    .then((j) => {
      if (j?.marks) {
        cache = j.marks as Marks;
        emit();
      }
    })
    .catch(() => {
      // A missing note is not worth an error on screen. The list still reads;
      // it just shows the system's verdict, which is the honest fallback.
      started = false;
    });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  load();
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): Marks {
  return cache;
}

/** What the drawer calls after a save, so every list showing this lead moves. */
export function setLocalMark(id: string, patch: Partial<Mark>) {
  const before: Mark = cache[id] ?? { note: null, grade: null };
  cache = { ...cache, [id]: { ...before, ...patch } };
  emit();
}

export function useMarks() {
  const marks = useSyncExternalStore(subscribe, snapshot, () => EMPTY);

  /** Attach what he has written to the rows about to be exported. */
  function withMarks(companies: Company[], listName?: (c: Company) => string): Exportable[] {
    return companies.map((c) => ({
      ...c,
      note: marks[c.id]?.note ?? null,
      ownGrade: marks[c.id]?.grade ?? null,
      ...(listName ? { listName: listName(c) } : {}),
    })) as Exportable[];
  }

  return { marks, withMarks };
}
