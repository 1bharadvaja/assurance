"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { apiBase, isDemoMode, pingBackend } from "../lib/api";

type Mode = "demo" | "live" | "down" | "loading";

export function BackendStatus() {
  const [mode, setMode] = useState<Mode>("loading");

  useEffect(() => {
    let cancelled = false;
    if (isDemoMode()) {
      setMode("demo");
      return () => {};
    }
    pingBackend().then((ok) => {
      if (!cancelled) setMode(ok ? "live" : "down");
    });
    const id = setInterval(() => {
      pingBackend().then((ok) => {
        if (!cancelled) setMode(ok ? "live" : "down");
      });
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const { label, dot, tooltip } = badge(mode);

  return (
    <span
      title={tooltip}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
        mode === "live" && "border-emerald-300 bg-emerald-50 text-emerald-800",
        mode === "demo" && "border-amber-300 bg-amber-50 text-amber-800",
        mode === "down" && "border-red-300 bg-red-50 text-red-800",
        mode === "loading" && "border-line bg-ink-50 text-ink-500"
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

function badge(mode: Mode) {
  switch (mode) {
    case "live":
      return {
        label: "Live verifier connected",
        dot: "bg-emerald-500",
        tooltip: `Live: ${apiBase()}`,
      };
    case "demo":
      return {
        label: "Static demo mode",
        dot: "bg-amber-500",
        tooltip: "Reading pre-computed verifier responses from /canned.",
      };
    case "down":
      return {
        label: "Verifier backend unavailable",
        dot: "bg-red-500",
        tooltip: `Could not reach ${apiBase()}. Playground will report errors honestly.`,
      };
    default:
      return {
        label: "Checking backend…",
        dot: "bg-ink-300",
        tooltip: "",
      };
  }
}
