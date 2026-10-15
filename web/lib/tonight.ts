import { getTide, type Country, type Tide } from "./grid";
import { clock, offsetMs, spokenTime, zonedToUtc } from "./grid/time";
import { APPLIANCES, findAppliance, type Appliance } from "./appliances";
import { planRun, tideMarks, typicalCost } from "./plan";
import { money, moneySpoken } from "./format";
import { log } from "./log";
import { loadHome, updateHome, type HomeState } from "./store";
import { storage } from "./storage";

/**
 * "Tonight's plan". Amazon EventBridge Scheduler runs the roll to the end at 16:45 and 18:30 London time, after
 * Octopus Agile publishes tomorrow's prices (around 16:00 UK time; see lib/scheduled.ts). The same roll is also the
 * lazy fallback: the first request after the prices are published computes that household's plan for the coming
 * night once, and each request takes one bounded step through the others. Either way the plan is stored in the
 * household's own S3 object, written with If-Match like every other update. Asking again the same night reads
 * the stored plan; a second instance racing the first sees the night already written and leaves it.
 *
 * A night runs 18:00 to 08:00 in the household's time zone and is named by the evening's date. Until 06:00 the
 * night in progress is still "tonight".
 */
export interface TonightItem {
  appliance: string;
  label: string;
  action: string;
  start: number;
  end: number;
  cost: number;
  typical: number | null;
}

export interface TonightPlan {
  night: string;
  computedAt: number;
  windowStart: number;
  windowEnd: number;
  region: string;
  tariff: string;
  timeZone: string;
  currency: Tide["region"]["currency"];
  cheapest: { start: number; end: number; avgPrice: number } | null;
  typicalPrice: number;
  unusual: boolean;
  items: TonightItem[];
  headline: string;
  sentence: string;
}

export const ZONES: Record<Country, string> = { GB: "Europe/London", US: "America/Chicago", DE: "Europe/Berlin" };
const NIGHT_FROM = 18;
const NIGHT_TO = 8;
const STILL_TONIGHT_UNTIL = 6;
/** Tonight's cheapest hour at or below this share of the day's average price counts as unusually cheap. */
const UNUSUAL = 0.6;
const GUEST_APPLIANCES = ["tumble-dryer", "dishwasher", "washing-machine"];

export function nightOf(now: number, timeZone: string): { night: string; start: number; end: number } {
  const local = new Date(now + offsetMs(now, timeZone));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate() - (local.getUTCHours() < STILL_TONIGHT_UNTIL ? 1 : 0);
  return {
    night: new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10),
    start: zonedToUtc(y, m, d, NIGHT_FROM, 0, timeZone),
    end: zonedToUtc(y, m, d + 1, NIGHT_TO, 0, timeZone),
  };
}

/** True once the published prices reach the end of tonight (Agile: after about 16:00 UK time). */
export const publishedFor = (tide: Tide, now: number) => {
  const last = tide.slots[tide.slots.length - 1];
  return Boolean(last && last.end >= nightOf(now, tide.region.timeZone).end);
};

/** The appliances a household actually uses (most recent first, up to three), or a sensible default set. */
export function appliancesFor(state: HomeState | null): Appliance[] {
  const ids: string[] = [];
  for (const r of [...(state?.runs ?? [])].sort((a, b) => b.createdAt - a.createdAt)) {
    if (!ids.includes(r.appliance)) ids.push(r.appliance);
    if (ids.length === 3) break;
  }
  const list = (ids.length ? ids : GUEST_APPLIANCES).map((id) => APPLIANCES.find((a) => a.id === id)).filter((a): a is Appliance => Boolean(a));
  return list.length ? list : [findAppliance("dishwasher")!];
}

/** Plans tonight for the given appliances, or null while tomorrow's prices aren't out yet. Pure, apart from the clock passed in. */
export function planTonight(tide: Tide, appliances: Appliance[], now: number, overrides: HomeState["overrides"] = {}): TonightPlan | null {
  if (!publishedFor(tide, now)) return null;
  const tz = tide.region.timeZone;
  const n = nightOf(now, tz);
  const earliest = Math.max(n.start, now);
  const night = tide.slots.filter((s) => s.end > earliest && s.start < n.end);
  if (!night.length) return null;
  const day = tide.slots.filter((s) => s.start < now + 24 * 3600_000);
  const typicalPrice = day.reduce((a, s) => a + s.price, 0) / Math.max(1, day.length);
  const { low } = tideMarks(night, 60);
  const items: TonightItem[] = [];
  for (const app of appliances) {
    const o = overrides[app.id] ?? {};
    const kwh = o.kwh ?? app.kwh;
    const minutes = o.minutes ?? app.minutes;
    try {
      const plan = planRun(tide.slots, { kwh, minutes, now, earliest, finishBy: n.end });
      items.push({ appliance: app.id, label: app.name, action: app.action, start: plan.best.start, end: plan.best.end, cost: plan.best.cost, typical: typicalCost(tide.slots, minutes, kwh, now) });
    } catch {
      /* it doesn't fit tonight (a 4-hour charge at 05:00): leave it out */
    }
  }
  if (!items.length) return null;
  // Lead with the load where tonight matters most.
  items.sort((a, b) => (b.typical ?? b.cost) - b.cost - ((a.typical ?? a.cost) - a.cost));
  const unusual = Boolean(low && (low.avgPrice <= 0 || low.avgPrice <= typicalPrice * UNUSUAL));
  const { headline, sentence } = words(tide, items, unusual, low?.avgPrice ?? null);
  return {
    night: n.night,
    computedAt: now,
    windowStart: earliest,
    windowEnd: n.end,
    region: tide.region.name,
    tariff: tide.region.tariff,
    timeZone: tz,
    currency: tide.region.currency,
    cheapest: low ? { start: low.start, end: low.end, avgPrice: low.avgPrice } : null,
    typicalPrice: Math.round(typicalPrice * 100) / 100,
    unusual,
    items,
    headline,
    sentence,
  };
}

function words(tide: Tide, items: TonightItem[], unusual: boolean, lowPrice: number | null) {
  const tz = tide.region.timeZone;
  const [first, second] = items;
  const saving = first.typical != null ? first.typical - first.cost : 0;
  const cost = first.cost <= 0 ? `it pays you about ${moneySpoken(-first.cost, tide.region)}` : `it costs about ${moneySpoken(first.cost, tide.region)}`;
  const vs = saving >= 1 ? `, ${moneySpoken(saving, tide.region)} less than a typical start` : "";
  const lead =
    lowPrice != null && lowPrice <= 0
      ? `Tonight you get paid to use power: ${first.action} at ${spokenTime(first.start, tz)}`
      : unusual
        ? `Tonight is unusually cheap: ${first.action} at ${spokenTime(first.start, tz)}`
        : `Tonight's best time to ${first.action} is ${spokenTime(first.start, tz)}`;
  let sentence = `${lead}, and ${cost}${vs}.`;
  if (second) sentence += ` The ${second.label} fits best at ${spokenTime(second.start, tz)}.`;
  const headline = unusual ? `Tonight is unusually cheap: ${first.label} at ${clock(first.start, tz)}` : `Tonight: ${first.label} at ${clock(first.start, tz)}, ${money(first.cost, tide.region)}`;
  return { headline, sentence };
}

type Deps = { getTide?: (place: string, country?: Country) => Promise<Tide>; now?: number };

/**
 * The household's plan for tonight: the stored one if this night was already planned, else computed now and
 * stored (once; If-Match guards the write). `fresh` says whether this call wrote it. While tomorrow's prices
 * aren't out, the last plan is returned only if its night hasn't ended.
 */
export async function tonightForHome(id: string, deps: Deps = {}): Promise<{ plan: TonightPlan | null; fresh: boolean; ready: boolean }> {
  const now = deps.now ?? Date.now();
  const state = await loadHome(id);
  if (!state) throw new Error("This Lowtide link doesn't match a household. Get a new one on the Lowtide website.");
  const n = nightOf(now, ZONES[state.home.country] ?? "Europe/London");
  if (state.tonight?.night === n.night) return { plan: state.tonight, fresh: false, ready: true };
  const tide = await (deps.getTide ?? getTide)(state.home.place, state.home.country);
  const plan = planTonight(tide, appliancesFor(state), now, state.overrides);
  if (!plan) {
    const last = state.tonight && state.tonight.windowEnd > now ? state.tonight : null;
    return { plan: last, fresh: false, ready: false };
  }
  let fresh = false;
  const next = await updateHome(id, (s) => {
    fresh = false; // a retried attempt starts over
    if (s.tonight?.night === plan.night) return false; // another instance planned this night first
    s.tonight = plan;
    fresh = true;
  });
  return { plan: next.tonight ?? plan, fresh, ready: true };
}

/** Tonight for a place without a household (the guest endpoint, the home page): computed, never stored. */
export async function tonightForPlace(place: string, deps: Deps = {}): Promise<{ plan: TonightPlan | null; ready: boolean }> {
  const now = deps.now ?? Date.now();
  const tide = await (deps.getTide ?? getTide)(place);
  const plan = planTonight(tide, appliancesFor(null), now);
  return { plan, ready: Boolean(plan) };
}

const ACTIVE_DAYS = 14;
const rollKey = (night: string) => `tonight/roll-${night}.json`;

/**
 * One step of the nightly roll: plans tonight for the next few households (in key order, after the stored
 * cursor), within a time budget, so the plans are ready before anyone asks. Called on ordinary requests once
 * Agile has published; idempotent per household, and the cursor is advanced with If-Match so two instances
 * don't both walk the same stretch. Households quiet for two weeks are skipped.
 */
export async function rollTonight(deps: Deps & { limit?: number; budgetMs?: number } = {}): Promise<{ night: string | null; computed: number; skipped: number; done: boolean }> {
  const now = deps.now ?? Date.now();
  const s = storage();
  const t0 = Date.now();
  const n = nightOf(now, ZONES.GB);
  const out = { night: n.night as string | null, computed: 0, skipped: 0, done: false };
  if (!s) return { ...out, night: null };
  try {
    // Gate on Britain's prices: until Agile publishes tomorrow, there's nothing new to plan.
    const london = await (deps.getTide ?? getTide)("SE1 7PB").catch(() => null);
    if (!london || !publishedFor(london, now)) return { ...out, night: null };
    const marker = await s.read(rollKey(n.night)).catch(() => null);
    const state = marker ? (JSON.parse(marker.text) as { cursor?: string; done?: boolean; computed?: number }) : {};
    if (state.done) return { ...out, done: true };
    const limit = deps.limit ?? 20;
    const keys = await s.list("homes/", limit, state.cursor);
    let cursor = state.cursor;
    for (const key of keys) {
      if (Date.now() - t0 > (deps.budgetMs ?? 2500)) break;
      cursor = key;
      const id = key.replace(/^homes\//, "").replace(/\.json$/, "");
      try {
        const home = await loadHome(id);
        const lastActive = Math.max(home?.home.createdAt ?? 0, ...(home?.runs ?? []).map((r) => r.createdAt));
        if (!home || now - lastActive > ACTIVE_DAYS * 86_400_000) {
          out.skipped++;
          continue;
        }
        const r = await tonightForHome(id, deps);
        if (r.fresh) out.computed++;
        else out.skipped++;
      } catch {
        out.skipped++;
      }
    }
    out.done = keys.length < limit && (keys.length === 0 || cursor === keys[keys.length - 1]);
    await s
      .write(rollKey(n.night), JSON.stringify({ cursor, done: out.done, computed: (state.computed ?? 0) + out.computed, at: now }), { ifMatch: marker?.etag })
      .catch(() => {
        /* another instance moved the cursor first; its households are planned either way */
      });
    log({ evt: "tonight", scope: "roll", ms: Date.now() - t0, ok: true, computed: out.computed, skipped: out.skipped, night: n.night });
    return out;
  } catch (e) {
    log({ evt: "tonight", scope: "roll", ms: Date.now() - t0, ok: false, error: e instanceof Error ? e.message : String(e) });
    return out;
  }
}
