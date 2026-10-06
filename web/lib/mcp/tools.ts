import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { getTide, type Region, type Slot, type Tide } from "../grid";
import { clock, dayPart, spokenTime } from "../grid/time";
import { APPLIANCES, findAppliance, type Appliance } from "../appliances";
import { costRun, planRun, tideMarks, type Goal, type Plan, type Run } from "../plan";
import { duration, grams, money, moneySpoken, rate } from "../format";
import { nextClockTime } from "../when";
import { loadHome, updateHome, type HomeState, type ScheduledRun } from "../store";
import { VIEW_HTML } from "../generated/view";

export const VIEW_URI = "ui://lowtide/tide-chart.html";

export const SERVER_INSTRUCTIONS = `Lowtide tells a household when electricity is cheapest and cleanest, and when to run shiftable appliances (dishwasher, washing machine, tumble dryer, EV charger, immersion heater, home battery).
Prices are live: Octopus Agile half-hourly rates across Britain (by postcode), ComEd hourly pricing in northern Illinois, and the German day-ahead spot price. Britain also has a regional carbon forecast.
Answer like a voice assistant: lead with the time and the saving in one short sentence, then stop. Read times the way people say them ("one thirty a.m."). Never read out raw tables.
Use plan_appliance for "when should I run...", then schedule_run only when the person agrees (it saves the run; it does not switch anything on). Use get_tide for general "when is power cheap" questions (pass after: "18:00" for "tonight") and check_now for "is now a good time", with the appliance if they named one.`;

/** What the view draws. Kept compact: it travels in every tool result. */
export interface ViewData {
  kind: "tide" | "plan" | "scheduled" | "runs" | "now" | "savings";
  headline: string;
  sub: string;
  region: Pick<Region, "name" | "tariff" | "unit" | "currency" | "timeZone" | "priceNote" | "carbonSource">;
  slots: { s: number; e: number; p: number; c: number | null }[];
  now: number;
  marks: { low: Run | null; high: Run | null };
  berths: { start: number; end: number; label: string; state: "best" | "now" | "planned" | "done" | "alt" }[];
  facts: { label: string; value: string }[];
  mix: { fuel: string; perc: number }[] | null;
}

type Ctx = { homeId: string | null };

const placeArg = z
  .string()
  .min(2)
  .max(40)
  .optional()
  .describe("UK postcode (e.g. SW1A 2AA), 'Chicago' or another northern Illinois place, or 'Germany'. Optional once the household is set up.");

export function registerLowtide(server: McpServer, ctx: Ctx) {
  registerAppResource(server, "Lowtide day dial", VIEW_URI, { mimeType: RESOURCE_MIME_TYPE, description: "The next 24 hours of electricity prices on a dial" }, async () => ({
    contents: [
      {
        uri: VIEW_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: VIEW_HTML,
        _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] } } },
      },
    ],
  }));

  const ui = { ui: { resourceUri: VIEW_URI } };

  registerAppTool(
    server,
    "get_tide",
    {
      title: "Electricity prices, next 24 hours",
      description:
        "The next day of electricity prices (and grid carbon where published) for the household, with the cheapest and dearest hours. Use for 'when is electricity cheap tonight?'.",
      inputSchema: z.object({
        place: placeArg,
        after: z.string().max(30).optional().describe("Only look from this local clock time on, e.g. '18:00' when they ask about tonight"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: ui,
    },
    async ({ place, after }) => {
      const { tide } = await tideFor(ctx, place);
      const tz = tide.region.timeZone;
      const now = Date.now();
      const from = after ? nextClockTimeOrThrow(after, tz, now) : null;
      // "Tonight" starts at the asked hour, or now if that hour has already begun.
      const window = from && from - now < 20 * 3600_000 ? tide.slots.filter((s) => s.end > from) : tide.slots;
      const { low, high } = tideMarks(window.length >= 2 ? window : tide.slots, 60);
      const cur = currentSlot(tide.slots, now);
      const headline = low ? `Cheapest at ${clock(low.start, tz)} ${shortDay(low.start, now, tz)}` : "Prices are flat for now";
      const sub = low && high
        ? `${rate(low.avgPrice, tide.region)} then, against ${rate(high.avgPrice, tide.region)} at ${clock(high.start, tz)}${cur ? `. Now: ${rate(cur.price, tide.region)}` : ""}.`
        : "";
      const facts = [
        ...(cur ? [{ label: "Now", value: rate(cur.price, tide.region) }] : []),
        ...(low ? [{ label: "Cheapest hour", value: `${clock(low.start, tz)}, ${rate(low.avgPrice, tide.region)}` }] : []),
        ...(high ? [{ label: "Dearest hour", value: `${clock(high.start, tz)}, ${rate(high.avgPrice, tide.region)}` }] : []),
        ...greenFact(tide),
      ];
      const view = viewOf("tide", tide, headline, sub, facts, [], now);
      const spoken = low && high
        ? `Electricity in ${spokenPlace(tide.region)} is cheapest ${dayPart(low.start, now, tz)} around ${spokenTime(low.start, tz)}, at ${spokenRate(low.avgPrice, tide.region)} a unit, and dearest around ${spokenTime(high.start, tz)} at ${spokenRate(high.avgPrice, tide.region)}.${cur ? ` Right now it's ${spokenRate(cur.price, tide.region)}.` : ""}`
        : "Prices are flat at the moment.";
      return result(spoken, view);
    },
  );

  registerAppTool(
    server,
    "check_now",
    {
      title: "Is now a good time to use power?",
      description: "Whether right now is a cheap or expensive (and clean or dirty) time to use electricity, compared with the rest of the published day, and how long until it gets cheaper.",
      inputSchema: z.object({
        place: placeArg,
        appliance: z.string().min(2).max(40).optional().describe("What they want to switch on now, e.g. tumble dryer, so the answer compares its cost now with the cheapest later start"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: ui,
    },
    async ({ place, appliance }) => {
      const { tide, state } = await tideFor(ctx, place);
      const now = Date.now();
      const tz = tide.region.timeZone;
      const cur = currentSlot(tide.slots, now);
      if (!cur) throw new Error("There's no published price for this half hour yet.");
      const app = appliance ? findAppliance(appliance) : null;
      const prices = tide.slots.map((s) => s.price).sort((a, b) => a - b);
      const rank = prices.findIndex((p) => p >= cur.price) / Math.max(1, prices.length - 1);
      const verdict = rank <= 0.25 ? "a good time" : rank <= 0.6 ? "an average time" : "an expensive time";
      const cheaper = tide.slots.find((s) => s.start > now && s.price <= prices[Math.floor(prices.length * 0.25)]);
      const headline = `Now is ${verdict}`;
      const sub = `${rate(cur.price, tide.region)} until ${clock(cur.end, tz)}${cheaper ? `. It drops to ${rate(cheaper.price, tide.region)} at ${clock(cheaper.start, tz)}` : ""}.`;
      const facts = [
        { label: "Now", value: rate(cur.price, tide.region) },
        { label: "Cheaper than", value: `${Math.round((1 - rank) * 100)}% of the day` },
        ...(cur.carbon != null ? [{ label: "Grid carbon", value: `${cur.carbon} g/kWh` }] : []),
        ...(cheaper ? [{ label: "Next cheap stretch", value: clock(cheaper.start, tz) }] : []),
      ];
      if (app) {
        // The question was about one load: price it now and at its best later start.
        const { kwh, minutes } = loadFor(app, state);
        const nowRun = costRun(tide.slots, now, minutes, kwh);
        let best: ReturnType<typeof costRun> = null;
        try {
          best = planRun(tide.slots, { kwh, minutes, now, earliest: now + 30 * 60_000 }).best;
        } catch {}
        if (nowRun) {
          const better = best && best.cost < nowRun.cost - 1 ? best : null;
          const headlineApp = better ? `${cap(app.action)} at ${clock(better.start, tz)} instead` : `${cap(app.action)} now`;
          const subApp = better
            ? `${money(nowRun.cost, tide.region)} now, ${money(better.cost, tide.region)} at ${clock(better.start, tz)}. ${rate(cur.price, tide.region)} this half hour.`
            : `${money(nowRun.cost, tide.region)} now, and it doesn't get much cheaper later. ${rate(cur.price, tide.region)} this half hour.`;
          const factsApp = [
            { label: `${cap(app.name)} now`, value: money(nowRun.cost, tide.region) },
            ...(better ? [{ label: `At ${clock(better.start, tz)}`, value: money(better.cost, tide.region) }] : []),
            { label: "Price now", value: rate(cur.price, tide.region) },
            ...(cur.carbon != null ? [{ label: "Grid carbon", value: `${cur.carbon} g/kWh` }] : []),
          ];
          const berthsApp: ViewData["berths"] = better ? [{ start: better.start, end: better.end, label: app.name, state: "best" }] : [];
          const viewApp = viewOf("now", tide, headlineApp, subApp, factsApp, berthsApp, now);
          const spokenApp = better
            ? `Now is ${verdict} to ${app.action}: about ${moneySpoken(nowRun.cost, tide.region)}. Wait until ${spokenTime(better.start, tz)} and it's ${moneySpoken(better.cost, tide.region)}, ${moneySpoken(nowRun.cost - better.cost, tide.region)} less.`
            : `Now is ${verdict} to ${app.action}: about ${moneySpoken(nowRun.cost, tide.region)}, and it doesn't get much cheaper later.`;
          const r = result(spokenApp, viewApp);
          if (better) r.content.push({ type: "text" as const, text: `For schedule_run, pass start "${new Date(better.start).toISOString()}". Don't read this line aloud.` });
          return r;
        }
      }
      const view = viewOf("now", tide, headline, sub, facts, [], now);
      const spoken = `Now is ${verdict} to use power: ${spokenRate(cur.price, tide.region)} a unit.${cheaper ? ` It drops to ${spokenRate(cheaper.price, tide.region)} at ${spokenTime(cheaper.start, tz)}.` : ""}`;
      return result(spoken, view);
    },
  );

  registerAppTool(
    server,
    "plan_appliance",
    {
      title: "Best time to run an appliance",
      description:
        "Finds the cheapest (or greenest) time to run a shiftable appliance, optionally finishing by a deadline, and compares it with starting now. Appliances: " +
        APPLIANCES.map((a) => a.name).join(", ") +
        ". Does not schedule anything; call schedule_run if the person agrees.",
      inputSchema: z.object({
        appliance: z.string().min(2).max(40).describe("e.g. dishwasher, washing machine, tumble dryer, car, hot water"),
        finish_by: z.string().max(30).optional().describe("Local clock time it must be done by, e.g. '07:00' or '7am'"),
        start_after: z.string().max(30).optional().describe("Local clock time it can't start before, e.g. '22:00'"),
        goal: z.enum(["cheapest", "greenest", "balanced"]).optional().describe("Default cheapest"),
        kwh: z.number().min(0.1).max(100).optional().describe("Energy needed, e.g. 20 for an EV top-up"),
        minutes: z.number().int().min(15).max(720).optional(),
        place: placeArg,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: ui,
    },
    async (args) => {
      const { tide, state } = await tideFor(ctx, args.place);
      const tz = tide.region.timeZone;
      const now = Date.now();
      const app = applianceOrThrow(args.appliance);
      const { kwh, minutes } = loadFor(app, state, args.kwh, args.minutes);
      let finishBy = args.finish_by ? nextClockTimeOrThrow(args.finish_by, tz, now) : undefined;
      let earliest = args.start_after ? nextClockTimeOrThrow(args.start_after, tz, now) : undefined;
      // "Done by seven", asked at half past six, means tomorrow morning, not in thirty minutes.
      if (finishBy && !/^\d{4}-/.test(args.finish_by!) && finishBy - now < minutes * 60_000) finishBy += 86_400_000;
      // "After ten, done by seven", asked after ten at night: the window has already opened.
      if (earliest && finishBy && earliest >= finishBy) earliest = Math.max(now, earliest - 86_400_000);
      const plan = planRun(tide.slots, { kwh, minutes, goal: (args.goal as Goal) ?? "cheapest", finishBy, earliest, now });
      return planResult(tide, app, plan, now);
    },
  );

  registerAppTool(
    server,
    "schedule_run",
    {
      title: "Schedule an appliance run",
      description:
        "Saves a planned run for the household (after plan_appliance and the person's agreement) so Lowtide can remind them and count the saving. Pass the start time plan_appliance chose.",
      inputSchema: z.object({
        appliance: z.string().min(2).max(40),
        start: z.string().max(40).describe("Start time: the ISO time from plan_appliance, or a local clock time like '01:30'"),
        kwh: z.number().min(0.1).max(100).optional(),
        minutes: z.number().int().min(15).max(720).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) => {
      const id = requireHome(ctx);
      const { tide, state } = await tideFor(ctx);
      const tz = tide.region.timeZone;
      const now = Date.now();
      const app = applianceOrThrow(args.appliance);
      const { kwh, minutes } = loadFor(app, state, args.kwh, args.minutes);
      const start = nextClockTimeOrThrow(args.start, tz, now);
      if (start < now - 5 * 60_000) throw new Error("That start time has already passed. Ask me to plan it again.");
      const run = costRun(tide.slots, start, minutes, kwh);
      if (!run) throw new Error("Prices aren't published for that whole stretch yet, so I can't save it.");
      const ifNow = costRun(tide.slots, now, minutes, kwh);
      const saved: ScheduledRun = {
        id: crypto.randomUUID().slice(0, 8),
        appliance: app.id,
        label: app.name,
        start: run.start,
        end: run.end,
        kwh,
        cost: run.cost,
        costIfNow: ifNow?.cost ?? null,
        carbon: run.carbon,
        carbonIfNow: ifNow?.carbon ?? null,
        createdAt: now,
        status: "planned",
      };
      const next = await updateHome(id, (s) => {
        s.runs = [...s.runs.filter((r) => !(r.status === "planned" && r.appliance === app.id && r.end > now)), saved].slice(-200);
      });
      const upcoming = next.runs.filter((r) => r.status === "planned" && r.end > now).sort((a, b) => a.start - b.start);
      const headline = `${cap(app.name)} at ${clock(run.start, tz)}`;
      const sub = `Saved for ${clock(run.start, tz)} ${dayPart(run.start, now, tz)}${saved.costIfNow != null ? `, saving ${money(saved.costIfNow - saved.cost, tide.region)} on starting now` : ""}. Set the delay start, or ask me what's planned.`;
      const berths = upcoming.map((r) => ({ start: r.start, end: r.end, label: r.label, state: r.id === saved.id ? ("best" as const) : ("planned" as const) }));
      const view = viewOf("scheduled", tide, headline, sub, runFacts(tide, saved), berths, now);
      const spoken = `Saved. ${cap(app.action)} ${dayPart(run.start, now, tz)} at ${spokenTime(run.start, tz)}.${saved.costIfNow != null && saved.costIfNow - saved.cost >= 1 ? ` That saves ${moneySpoken(saved.costIfNow - saved.cost, tide.region)}.` : ""}`;
      return result(spoken, view);
    },
  );

  registerAppTool(
    server,
    "list_runs",
    {
      title: "Planned appliance runs",
      description: "The household's upcoming planned runs (and the last few finished ones) with their cost and saving.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async () => {
      requireHome(ctx);
      const { tide, state } = await tideFor(ctx);
      const tz = tide.region.timeZone;
      const now = Date.now();
      const runs = state!.runs.filter((r) => r.status === "planned");
      const upcoming = runs.filter((r) => r.end > now).sort((a, b) => a.start - b.start);
      const headline = upcoming.length
        ? upcoming.length === 1
          ? `${cap(upcoming[0].label)} at ${clock(upcoming[0].start, tz)}`
          : `${upcoming.length} runs planned`
        : "Nothing planned yet";
      const sub = upcoming.length
        ? upcoming.map((r) => `${r.label} ${clock(r.start, tz)}–${clock(r.end, tz)}`).join(", ")
        : "Ask when to run the dishwasher and I'll find the cheapest time.";
      const berths = upcoming.map((r) => ({ start: r.start, end: r.end, label: r.label, state: "planned" as const }));
      const facts = upcoming.slice(0, 4).map((r) => ({
        label: `${cap(r.label)} ${clock(r.start, tz)}`,
        value: `${money(r.cost, tide.region)}${r.costIfNow != null ? `, saves ${money(r.costIfNow - r.cost, tide.region)}` : ""}`,
      }));
      const view = viewOf("runs", tide, headline, sub, facts, berths, now);
      const spoken = upcoming.length
        ? `You have ${upcoming.length === 1 ? "one run" : `${upcoming.length} runs`} planned: ${upcoming.map((r) => `the ${r.label} at ${spokenTime(r.start, tz)}`).join(", and ")}.`
        : "Nothing is planned yet.";
      return result(spoken, view);
    },
  );

  registerAppTool(
    server,
    "cancel_run",
    {
      title: "Cancel a planned run",
      description: "Cancels the household's upcoming planned run for an appliance.",
      inputSchema: z.object({ appliance: z.string().min(2).max(40) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async ({ appliance }) => {
      const id = requireHome(ctx);
      const app = applianceOrThrow(appliance);
      const now = Date.now();
      let found = false;
      const next = await updateHome(id, (s) => {
        for (const r of s.runs) {
          if (r.status === "planned" && r.appliance === app.id && r.end > now) {
            r.status = "cancelled";
            found = true;
          }
        }
      });
      const tide = await getTide(next.home.place, next.home.country);
      const upcoming = next.runs.filter((r) => r.status === "planned" && r.end > now);
      const headline = found ? `${cap(app.name)} cancelled` : `No ${app.name} run was planned`;
      const view = viewOf(
        "runs",
        tide,
        headline,
        upcoming.length ? `Still planned: ${upcoming.map((r) => `${r.label} ${clock(r.start, tide.region.timeZone)}`).join(", ")}.` : "Nothing else is planned.",
        [],
        upcoming.map((r) => ({ start: r.start, end: r.end, label: r.label, state: "planned" as const })),
        now,
      );
      return result(found ? `Okay, I've cancelled the ${app.name}.` : `There wasn't a ${app.name} run planned.`, view);
    },
  );

  registerAppTool(
    server,
    "get_savings",
    {
      title: "Money and carbon saved",
      description: "How much the household has saved by running appliances at the cheapest time instead of when they asked, this week and in total.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async () => {
      requireHome(ctx);
      const { tide, state } = await tideFor(ctx);
      const now = Date.now();
      // Only runs that have started count as saved; later ones are "lined up".
      const counted = state!.runs.filter((r) => r.status === "planned" && r.costIfNow != null);
      const done = counted.filter((r) => r.start <= now);
      const lined = counted.filter((r) => r.start > now);
      const week = done.filter((r) => r.start > now - 7 * 86400_000);
      const sum = (rs: ScheduledRun[]) => rs.reduce((a, r) => a + (r.costIfNow! - r.cost), 0);
      const co2 = (rs: ScheduledRun[]) =>
        rs.reduce((a, r) => a + (r.carbonIfNow != null && r.carbon != null ? r.carbonIfNow - r.carbon : 0), 0);
      const headline = done.length ? `${money(sum(done), tide.region)} saved so far` : "No runs counted yet";
      const sub = done.length
        ? `${done.length} ${done.length === 1 ? "run" : "runs"} moved to cheaper hours${co2(done) > 0 ? `, ${grams(co2(done))} less CO₂` : ""}.`
        : lined.length
          ? `${money(sum(lined), tide.region)} more is lined up in ${lined.length} planned ${lined.length === 1 ? "run" : "runs"}.`
          : "Plan a run and I'll count what you save.";
      const facts = [
        { label: "This week", value: money(sum(week), tide.region) },
        { label: "All time", value: money(sum(done), tide.region) },
        { label: "Runs moved", value: String(done.length) },
        ...(co2(done) > 0 ? [{ label: "CO₂ avoided", value: grams(co2(done)) }] : []),
      ];
      const view = viewOf("savings", tide, headline, sub, facts, [], now);
      return result(
        done.length ? `You've saved ${moneySpoken(sum(done), tide.region)} so far, ${moneySpoken(sum(week), tide.region)} of it this week.` : "Nothing's been counted yet.",
        view,
      );
    },
  );

  server.registerTool(
    "set_home",
    {
      title: "Set the household's location",
      description: "Sets where the household is, which decides its tariff region: a UK postcode, a northern Illinois place, or Germany.",
      inputSchema: z.object({ place: z.string().min(2).max(40), name: z.string().max(40).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ place, name }) => {
      const id = requireHome(ctx);
      const tide = await getTide(place); // validates the place before saving it
      await updateHome(id, (s) => {
        s.home.place = place;
        s.home.country = tide.region.country;
        if (name) s.home.name = name;
      });
      return { content: [{ type: "text" as const, text: `Got it. You're on ${tide.region.tariff} in ${tide.region.name}.` }] };
    },
  );
}

/* ---------- helpers ---------- */

async function tideFor(ctx: Ctx, place?: string): Promise<{ tide: Tide; state: HomeState | null }> {
  const state = ctx.homeId ? await loadHome(ctx.homeId) : null;
  if (ctx.homeId && !state) throw new Error("This Lowtide link doesn't match a household. Get a new one on the Lowtide website.");
  const where = place ?? state?.home.place;
  if (!where) throw new Error("Which postcode or city are you in? Lowtide covers Britain, northern Illinois and Germany.");
  const tide = await getTide(where, place ? undefined : state?.home.country);
  return { tide, state };
}

function requireHome(ctx: Ctx): string {
  if (!ctx.homeId) {
    throw new Error("Saving runs needs your own Lowtide link. Make one free on the Lowtide website, then add it as the connector URL.");
  }
  return ctx.homeId;
}

function applianceOrThrow(name: string): Appliance {
  const a = findAppliance(name);
  if (!a) throw new Error(`I can plan a ${APPLIANCES.map((x) => x.name).join(", ")}. Which one is it?`);
  return a;
}

function loadFor(app: Appliance, state: HomeState | null, kwh?: number, minutes?: number) {
  const o = state?.overrides[app.id] ?? {};
  const k = kwh ?? o.kwh ?? app.kwh;
  // An EV top-up with a different energy takes proportionally longer at the same charger power.
  const m = minutes ?? o.minutes ?? (app.id === "ev" && kwh ? Math.ceil(((kwh / 7.4) * 60) / 15) * 15 : app.minutes);
  return { kwh: k, minutes: m };
}

function nextClockTimeOrThrow(s: string, tz: string, now: number): number {
  const t = nextClockTime(s, tz, now);
  if (t === null) throw new Error(`I couldn't read "${s}" as a time. Try something like 07:00.`);
  return t;
}

function currentSlot(slots: Slot[], now: number) {
  return slots.find((s) => s.start <= now && now < s.end) ?? null;
}

function greenFact(tide: Tide) {
  const withC = tide.slots.filter((s) => s.carbon != null);
  if (!withC.length) return [];
  const g = withC.reduce((a, b) => (b.carbon! < a.carbon! ? b : a));
  return [{ label: "Cleanest", value: `${clock(g.start, tide.region.timeZone)}, ${g.carbon} g/kWh` }];
}

export function planResult(tide: Tide, app: Appliance, plan: Plan, now: number) {
  const tz = tide.region.timeZone;
  const b = plan.best;
  const startsNow = b.start - now < 5 * 60_000;
  const headline = startsNow ? `${cap(app.action)} now` : `${cap(app.action)} at ${clock(b.start, tz)}`;
  const vsNow = plan.now && !startsNow ? `, ${money(b.cost, tide.region)} instead of ${money(plan.now.cost, tide.region)} now` : `, ${money(b.cost, tide.region)}`;
  const sub = `${duration(plan.minutes)}, done by ${clock(b.end, tz)}${vsNow}.`;
  const facts = [
    { label: "Start", value: `${clock(b.start, tz)} ${dayPart(b.start, now, tz)}` },
    { label: "Cost", value: `${money(b.cost, tide.region)} (${rate(b.avgPrice, tide.region)})` },
    ...(plan.now ? [{ label: "If started now", value: money(plan.now.cost, tide.region) }] : []),
    ...(b.carbon != null && plan.now?.carbon != null ? [{ label: "CO₂", value: `${grams(b.carbon)} vs ${grams(plan.now.carbon)}` }] : []),
    { label: "Load", value: `${plan.kwh} kWh over ${duration(plan.minutes)}` },
  ];
  const berths: ViewData["berths"] = [{ start: b.start, end: b.end, label: app.name, state: "best" }];
  if (plan.greenest && plan.goal === "cheapest" && plan.greenest.start !== b.start) {
    berths.push({ start: plan.greenest.start, end: plan.greenest.end, label: "greenest", state: "alt" });
  }
  const view = viewOf("plan", tide, headline, sub, facts, berths, now);
  const saving = plan.now ? plan.now.cost - b.cost : 0;
  let spoken = startsNow
    ? `Now's the cheapest time to ${app.action}: about ${moneySpoken(b.cost, tide.region)}.`
    : `${cap(app.action)} ${dayPart(b.start, now, tz)} at ${spokenTime(b.start, tz)}. It costs about ${moneySpoken(b.cost, tide.region)}${saving >= 1 ? `, ${moneySpoken(saving, tide.region)} less than starting now` : ""}.`;
  if (plan.greenest && plan.goal === "cheapest" && plan.greenest.start !== b.start && b.carbon != null) {
    spoken += ` The cleanest start would be ${spokenTime(plan.greenest.start, tz)}.`;
  }
  const r = result(spoken, view);
  r.content.push({ type: "text" as const, text: `For schedule_run, pass start "${new Date(b.start).toISOString()}" and minutes ${plan.minutes}. Don't read this line aloud.` });
  return r;
}

function runFacts(tide: Tide, r: ScheduledRun) {
  const tz = tide.region.timeZone;
  return [
    { label: "Start", value: clock(r.start, tz) },
    { label: "Done by", value: clock(r.end, tz) },
    { label: "Cost", value: money(r.cost, tide.region) },
    ...(r.costIfNow != null ? [{ label: "Saving", value: money(r.costIfNow - r.cost, tide.region) }] : []),
  ];
}

function viewOf(
  kind: ViewData["kind"],
  tide: Tide,
  headline: string,
  sub: string,
  facts: ViewData["facts"],
  berths: ViewData["berths"],
  now: number,
): ViewData {
  const horizon = Math.max(now + 24 * 3600_000, ...berths.map((b) => b.end + 3600_000));
  const slots = tide.slots.filter((s) => s.start < horizon).map((s) => ({ s: s.start, e: s.end, p: s.price, c: s.carbon }));
  const { low, high } = tideMarks(tide.slots.filter((s) => s.start < horizon), 60);
  const r = tide.region;
  return {
    kind,
    headline,
    sub,
    region: { name: r.name, tariff: r.tariff, unit: r.unit, currency: r.currency, timeZone: r.timeZone, priceNote: r.priceNote, carbonSource: r.carbonSource },
    slots,
    now,
    marks: { low, high },
    berths,
    facts,
    mix: tide.mix?.filter((m) => m.perc >= 1).slice(0, 6) ?? null,
  };
}

function result(text: string, view: ViewData) {
  return {
    content: [{ type: "text" as const, text: text.replace(/\.\./g, ".") }],
    structuredContent: view as unknown as Record<string, unknown>,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "tomorrow", "tonight", "today" for a headline. */
const shortDay = (t: number, now: number, tz: string) =>
  dayPart(t, now, tz).replace(/^tomorrow .*/, "tomorrow").replace(/^(early )?this morning$/, "this morning").replace(/^this (afternoon|evening)$/, "today");
const unitWord = (r: Pick<Region, "currency">) => (r.currency === "GBP" ? "pence" : "cents");
/** A unit price as a person says it: whole numbers from ten up, one decimal below, always with the unit. */
const spokenRate = (p: number, r: Pick<Region, "currency">) => `${Math.abs(p) >= 10 ? Math.round(p) : Number(p.toFixed(1))} ${unitWord(r)}`;
/** The region's name without anything in brackets, for speech. */
const spokenPlace = (r: Pick<Region, "name">) => r.name.replace(/\s*\(.*?\)/g, "");
