"use client";
import { useEffect, useState } from "react";
import { today } from "@/lib/format";
import { verseOfTheDay, type Verse } from "@/lib/verses";
import { LotusMark } from "./Brand";

/**
 * Verse of the day. Rendered only after mount: the date is read from the
 * browser's clock, and picking it during SSR would hand a stale verse to anyone
 * served from cache in a different timezone.
 */
export function VerseOfTheDay() {
  const [v, setV] = useState<Verse | null>(null);
  useEffect(() => setV(verseOfTheDay(today())), []);
  if (!v) return null;
  return (
    <section className="panel-sacred overflow-hidden rounded-lg border border-slate-200 shadow-card" aria-label="Verse of the day">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6">
        <LotusMark size={34} className="shrink-0 opacity-90" />
        <div className="min-w-0 flex-1">
          <p className="sanskrit whitespace-pre-line text-[15px] text-slate-700" lang="sa">{v.sa}</p>
          <p className="mt-2 text-sm italic text-slate-600">&ldquo;{v.en}&rdquo;</p>
        </div>
        <div className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-gold-ink sm:text-right">{v.ref}</div>
      </div>
    </section>
  );
}

/** The same verse, stacked and set on a dark hero panel (sign-in page). */
export function VerseHero({ verse }: { verse: Verse }) {
  return (
    <figure className="max-w-md space-y-4">
      <blockquote>
        <p className="sanskrit whitespace-pre-line text-[17px] text-cream" lang="sa">{verse.sa}</p>
        <p className="mt-3 whitespace-pre-line text-xs italic leading-relaxed text-cream/55">{verse.iast}</p>
        <p className="mt-4 text-sm leading-relaxed text-cream/85">{verse.en}</p>
      </blockquote>
      <figcaption className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-bright">— {verse.ref}</figcaption>
    </figure>
  );
}
