import { brand } from "@/lib/brand";

/* Petal pointing up from the centre of a 64x64 box, repeated by rotation.
   Drawn as flat fills (no gradients, no ids) so the mark can be dropped into
   a server component, a print sheet or a favicon without collisions. */
const OUTER = "M32 4.5 C 41.5 15 42 25 32 31.5 C 22 25 22.5 15 32 4.5 Z";
const INNER = "M32 14 C 38 21 38 27 32 32 C 26 27 26 21 32 14 Z";
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The temple mark: an eight-petalled lotus with a gold whorl and bindu.
 * Reads cleanly from 16px (favicon) to a full-page watermark.
 *
 * `print` swaps the theme variables for literal hex: print previews do not always
 * resolve custom properties, and a voucher that comes out of the printer with an
 * invisible crest is worse than no crest. (The report PDF draws its own copy of
 * these same petals — see lib/pdf.ts.)
 */
export function LotusMark({ size = 32, className = "", print = false }: { size?: number; className?: string; print?: boolean }) {
  const outer = print ? "#e8913b" : "var(--color-saffron)";
  const inner = print ? "#b85410" : "var(--color-brand)";
  const gold = print ? "#b8912a" : "var(--color-gold)";
  const eye = print ? "#ffffff" : "var(--color-surface)";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label={`${brand.name} lotus mark`}>
      <g>
        {ANGLES.map((a) => (
          <path key={`o${a}`} d={OUTER} transform={`rotate(${a} 32 32)`} fill={outer} />
        ))}
        {ANGLES.map((a) => (
          <path key={`i${a}`} d={INNER} transform={`rotate(${a + 22.5} 32 32)`} fill={inner} />
        ))}
      </g>
      <circle cx="32" cy="32" r="7" fill={gold} />
      <circle cx="32" cy="32" r="3" fill={eye} />
    </svg>
  );
}

/** Lotus mark on a saffron tile — the compact lockup for the sidebar and mobile bar. */
export function LotusBadge({ size = 36 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md bg-indigo-50 ring-1 ring-gold-soft"
      style={{ width: size, height: size }}
    >
      <LotusMark size={size * 0.72} />
    </span>
  );
}

/**
 * Name + what-this-is lockup. `tone="light"` is for dark backgrounds
 * (the sign-in hero), `tone="dark"` for the cream shell.
 */
export function Wordmark({ tone = "dark", size = "md" }: { tone?: "light" | "dark"; size?: "sm" | "md" | "lg" }) {
  const title = size === "lg" ? "text-2xl" : size === "md" ? "text-base" : "text-sm";
  return (
    <span className="min-w-0">
      <span className={`block truncate font-display ${title} font-bold ${tone === "light" ? "text-white" : "text-slate-800"}`}>
        {brand.name}
      </span>
      <span className={`block truncate text-[10px] font-semibold uppercase tracking-[0.18em] ${tone === "light" ? "text-gold-bright" : "text-gold-ink"}`}>{brand.app}</span>
    </span>
  );
}

/** A gold rule with a lotus resting at its centre, for closing a section. */
export function LotusDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold opacity-70" />
      <LotusMark size={14} />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold opacity-70" />
    </div>
  );
}

/** The maha-mantra, set small and quiet. Used in the sidebar footer and the sign-in hero. */
export function MahaMantra({ tone = "dark" }: { tone?: "light" | "dark" }) {
  return (
    <div className={`text-center ${tone === "light" ? "text-cream/60" : "text-slate-400"}`} lang="sa">
      <p className="sanskrit whitespace-pre-line text-[11px] leading-relaxed">{brand.mahamantra.devanagari}</p>
    </div>
  );
}

/** Concentric lotus rings, used as a near-invisible watermark behind hero panels. */
export function MandalaWatermark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2].map((ring) =>
        ANGLES.map((a) => (
          <path
            key={`${ring}-${a}`}
            d={OUTER}
            transform={`rotate(${a + ring * 22.5} 32 32) scale(${1 - ring * 0.22}) translate(${(32 * ring * 0.22) / (1 - ring * 0.22)} ${(32 * ring * 0.22) / (1 - ring * 0.22)})`}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.6}
          />
        )),
      )}
      <circle cx="32" cy="32" r="4" fill="none" stroke="currentColor" strokeWidth={0.6} />
    </svg>
  );
}
