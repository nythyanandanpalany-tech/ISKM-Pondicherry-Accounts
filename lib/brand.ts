/**
 * One place to edit the temple's identity.
 *
 * Everything user-facing — the sidebar, the sign-in page, the PWA name, printed
 * payment vouchers and the daily report letterhead — reads from here, so handing
 * this app to another centre is a single-file change.
 */
export const brand = {
  /** Short name, used in the sidebar and on mobile. */
  name: "ISKM Pondicherry",
  /** Full legal/registered name, used on printed vouchers and reports. */
  legalName: "International Sri Krishna Mandir — Puducherry",
  /** What this particular app is. */
  app: "Seva Accounts",
  /** One line under the wordmark on the sign-in page. */
  tagline: "Every rupee, an offering.",
  /** Shown on the letterhead of printed vouchers and reports. Leave "" to hide. */
  address: "Puducherry, Tamil Nadu",
  /** Greeting used across the app. "Haribol" also works. */
  greeting: "Hare Krishna",
  /** The maha-mantra, shown in the sidebar footer and on the sign-in page. */
  mahamantra: {
    devanagari: "हरे कृष्ण हरे कृष्ण कृष्ण कृष्ण हरे हरे\nहरे राम हरे राम राम राम हरे हरे",
    roman: "Hare Kṛṣṇa Hare Kṛṣṇa Kṛṣṇa Kṛṣṇa Hare Hare\nHare Rāma Hare Rāma Rāma Rāma Hare Hare",
  },
} as const;
