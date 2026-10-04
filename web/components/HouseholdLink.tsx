"use client";
import { useState } from "react";
import CopyField from "./CopyField";
import s from "./household.module.css";

export default function HouseholdLink() {
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ mcpUrl: string; region: string; tariff: string } | null>(null);

  return (
    <div className={s.wrap}>
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await fetch("/api/homes", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ place }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? "That didn't work.");
            setMade(j);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="place">Postcode or city</label>
        <div className={s.row}>
          <input
            id="place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="e.g. M1 1AE, Chicago, Germany"
            autoComplete="postal-code"
            required
            minLength={2}
            maxLength={40}
          />
          <button type="submit" disabled={busy || place.trim().length < 2}>
            {busy ? "Finding your tariff…" : "Make my link"}
          </button>
        </div>
        {error && <p className={s.error}>{error}</p>}
      </form>
      {made && (
        <div className={s.made}>
          <p>
            You&apos;re on <strong>{made.tariff}</strong> in <strong>{made.region}</strong>.
          </p>
          <CopyField value={made.mcpUrl} label="Your household's MCP link" />
        </div>
      )}
    </div>
  );
}
