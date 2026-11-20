import { brand } from "@/lib/brand";

/* Petal pointing up from the centre of a 64x64 box, repeated by rotation.
   Drawn as flat fills (no gradients, no ids) so the mark can be dropped into
   a server component, a print sheet or a favicon without collisions. */
const OUTER = "M32 4.5 C 41.5 15 42 25 32 31.5 C 22 25 22.5 15 32 4.5 Z";
const INNER = "M32 14 C 38 21 38 27 32 32 C 26 27 26 21 32 14 Z";
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The temple's logo — the lotus and domes of Pudhuvai Vrindavanam (public/logo.jpeg).
 * Served from pre-cut round PNGs (public/logo-64/128/256.png) so a 36px header badge does not
 * download the 1563px original; the browser picks the size the screen needs.
 */
export function TempleLogo({ size = 40, className = "", ring = true }: { size?: number; className?: string; ring?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-128.png"
      srcSet="/logo-64.png 64w, /logo-128.png 128w, /logo-256.png 256w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={`${brand.name} logo`}
      className={`shrink-0 rounded-full bg-white ${ring ? "ring-1 ring-gold-soft" : ""} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The small lotus ornament: an eight-petalled lotus in the logo's pink, with a gold whorl.
 * Used for dividers and the hero watermark; the logo itself is TempleLogo.
 *
 * `print` swaps the theme variables for literal hex: print previews do not always
 * resolve custom properties, and a voucher that comes out of the printer with an
 * invisible crest is worse than no crest. (The report PDF draws its own copy of
 * these same petals — see lib/pdf.ts.)
 */
export function LotusMark({ size = 32, className = "", print = false }: { size?: number; className?: string; print?: boolean }) {
  const outer = print ? "#d6657d" : "var(--color-lotus)";
  const inner = print ? "#c74566" : "var(--color-lotus-deep)";
  const gold = print ? "#cda855" : "var(--color-gold)";
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

/**
 * The logo for paper (printed vouchers, the daily report). A plain JPEG on white with a fixed size:
 * print previews do not always honour srcset or CSS variables, and a voucher that prints without
 * its crest is worse than none.
 */
export function PrintLogo({ size = 44 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-print.jpg" width={size} height={size} alt={`${brand.name} logo`} style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0 }} />;
}

/** The logo, sized for the sidebar and mobile bar. */
export function LotusBadge({ size = 36 }: { size?: number }) {
  return <TempleLogo size={size} />;
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

/**
 * Srila Prabhupada photo (Founder-Acharya of ISKCON / ISKM).
 * Uses /prabhupada-photo.png from the public directory.
 */
export function PrabhupadaPhoto({
  size = 64,
  rounded = "rounded-lg",
  className = "",
  showCaption = false,
}: {
  size?: number;
  rounded?: "rounded-full" | "rounded-lg" | "rounded-md" | "rounded";
  className?: string;
  showCaption?: boolean;
}) {
  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/prabhupada-photo.png"
        alt="His Divine Grace A.C. Bhaktivedanta Swami Prabhupada"
        width={size}
        height={Math.round((size * 500) / 458)}
        className={`${rounded} object-cover shadow-sm ring-1 ring-gold-soft`}
        style={{ width: size, height: "auto", aspectRatio: "458 / 500" }}
      />
      {showCaption && (
        <span className="mt-1 text-center text-[10px] font-medium tracking-wide text-slate-500">
          Śrīla Prabhupāda
        </span>
      )}
    </div>
  );
}
