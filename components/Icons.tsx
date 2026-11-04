/* Line icons for the dashboard tiles. Stroked in currentColor at 24x24 so they
   inherit the tile's saffron and stay crisp next to Inter's figures — emoji
   rendered inconsistently across the phones and desktops the sevaks use. */
type P = { className?: string };
const base = (className = "") => ({
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  className: `h-[18px] w-[18px] ${className}`, "aria-hidden": true,
});

export const RupeeIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M6 4h12M6 9h12M15.5 4c0 4-2.5 5-6 5h-.5l7.5 11" /></svg>
);
export const OutflowIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M7 17 17 7M9 7h8v8" /></svg>
);
export const InflowIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M17 7 7 17M15 17H7V9" /></svg>
);
export const PendingIcon = ({ className }: P) => (
  <svg {...base(className)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>
);
export const ReceiptIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5z" /><path d="M9.5 8.5h5M9.5 12.5h5" /></svg>
);
export const BankIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M3.5 9.5 12 4l8.5 5.5M5.5 10v7M9.5 10v7M14.5 10v7M18.5 10v7M3.5 20h17" /></svg>
);
export const CameraIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M4 8.5h2.8l1.4-2h7.6l1.4 2H20V18H4z" /><circle cx="12" cy="13" r="3" /></svg>
);
export const GalleryIcon = ({ className }: P) => (
  <svg {...base(className)}><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 16.5 8 12l3.5 3.5 3-3 6 6" /><circle cx="9" cy="9.5" r="1.2" /></svg>
);
