"use client";

import { useCallback, useEffect, useState } from "react";

import { GuidedReview } from "../components/GuidedReview";
import { Playground } from "../components/Playground";
import { TechnicalNotes } from "../components/TechnicalNotes";
import { TopNav, type TabId } from "../components/TopNav";

const TAB_FOR_HASH: Record<string, TabId> = {
  "": "guided",
  "#guided": "guided",
  "#playground": "playground",
  "#notes": "notes",
};

const HASH_FOR_TAB: Record<TabId, string> = {
  guided: "",
  playground: "#playground",
  notes: "#notes",
};

export default function Page() {
  const [tab, setTab] = useState<TabId>("guided");

  // Sync to the URL hash so links to the playground or notes survive
  // a refresh and can be shared.
  useEffect(() => {
    const fromHash = (): TabId =>
      TAB_FOR_HASH[window.location.hash || ""] ?? "guided";
    setTab(fromHash());
    const handler = () => setTab(fromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const select = useCallback((t: TabId) => {
    setTab(t);
    const newHash = HASH_FOR_TAB[t];
    if (typeof window !== "undefined") {
      const target = `${window.location.pathname}${window.location.search}${newHash}`;
      window.history.replaceState(null, "", target);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <main className="min-h-screen">
      <TopNav active={tab} onSelect={select} />
      {tab === "guided" && (
        <GuidedReview onOpenPlayground={() => select("playground")} />
      )}
      {tab === "playground" && <Playground />}
      {tab === "notes" && <TechnicalNotes />}
    </main>
  );
}
