"use client";
import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
export function getThemePref(): ThemePref {
  try { return (localStorage.getItem("ef_theme") as ThemePref) || "system"; } catch { return "system"; }
}
export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem("ef_theme", pref); } catch { /* ignore */ }
  applyTheme(pref); window.dispatchEvent(new Event("ef-theme"));
}
export function useThemePref() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => { setPref(getThemePref()); const h = () => setPref(getThemePref()); window.addEventListener("ef-theme", h); return () => window.removeEventListener("ef-theme", h); }, []);
  return pref;
}

/** Mount once in the root layout: applies the saved theme, follows the OS in "system" mode, and prints in light. */
export default function ThemeBoot() {
  useEffect(() => {
    applyTheme(getThemePref());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => getThemePref() === "system" && applyTheme("system");
    let was = false;
    const before = () => { was = document.documentElement.classList.contains("dark"); document.documentElement.classList.remove("dark"); };
    const after = () => { if (was) document.documentElement.classList.add("dark"); };
    mq.addEventListener("change", onMq); window.addEventListener("beforeprint", before); window.addEventListener("afterprint", after);
    return () => { mq.removeEventListener("change", onMq); window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  return null;
}
