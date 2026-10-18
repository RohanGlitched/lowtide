"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SceneData } from "@/lib/live";
import TonightPanels from "./TonightPanels";

export type Place = { key: string; label: string; scene: SceneData };

/** The place picked in the hero, shared with the rest of the home page and kept in the address (?place=). */
const Ctx = createContext<{ places: Place[]; place: Place; setKey: (k: string) => void } | null>(null);

export function PlaceProvider({ places, children }: { places: Place[]; children: ReactNode }) {
  const [key, setKeyState] = useState(places[0].key);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("place");
    if (q && places.some((p) => p.key === q)) setKeyState(q);
  }, [places]);
  const setKey = (k: string) => {
    setKeyState(k);
    const url = new URL(window.location.href);
    if (k === places[0].key) url.searchParams.delete("place");
    else url.searchParams.set("place", k);
    window.history.replaceState(null, "", url);
  };
  const place = places.find((p) => p.key === key) ?? places[0];
  return <Ctx.Provider value={{ places, place, setKey }}>{children}</Ctx.Provider>;
}

export function usePlace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlace outside PlaceProvider");
  return v;
}

/** "Tonight, already planned" for whichever place is picked. */
export function TonightSection() {
  const { place } = usePlace();
  const sc = place.scene;
  if (!sc.runs.length) return null;
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: sc.timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(sc.now)));
  const night = h >= 17 || h < 5;
  return (
    <section className="shell section" aria-labelledby="tonight-title">
      <div className="sectionHead">
        <h2 id="tonight-title" className="serif">
          {night ? "Tonight, already planned." : "The next day, already planned."}
        </h2>
        <p>
          {sc.runs.length === 4 ? "Four" : sc.runs.length} everyday loads in a {place.label} home, each placed in the cheapest stretch that still finishes {night ? "by morning" : "within the next day"}. The nightly
          schedule does this for every household before anyone asks.
        </p>
      </div>
      <TonightPanels scene={sc} place={place.label} />
    </section>
  );
}
