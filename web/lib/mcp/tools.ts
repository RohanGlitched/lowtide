import { z } from "zod";
import { inputRequired, inputResponse, type McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { getTide, type Region, type Slot, type Tide } from "../grid";
import { clock, dayPart, spokenTime } from "../grid/time";
import { APPLIANCES, findAppliance, type Appliance } from "../appliances";
import { cheapAndDear, costRun, planRun, type Goal, type Mark, type Plan, type Run } from "../plan";
import { duration, grams, money, moneySpoken, rate } from "../format";
import { nextClockTime, resolveDeadline, type Deadline } from "../when";
import { loadHome, updateHome, type HomeState, type ScheduledRun } from "../store";
import { VIEW_HTML } from "../generated/view";
import { tonightForHome, tonightForPlace, type TonightPlan } from "../tonight";
import { log } from "../log";

export const VIEW_URI = "ui://lowtide/tide-chart.html";
export const TONIGHT_URI = "lowtide://household/tonight";

export const SERVER_INSTRUCTIONS = `Lowtide tells a household when electricity is cheapest and cleanest, and when to run shiftable appliances (dishwasher, washing machine, tumble dryer, EV charger, immersion heater, home battery).
Prices are live: Octopus Agile half-hourly rates across Britain (by postcode), ComEd hourly pricing in northern Illinois, and the German day-ahead spot price. Britain also has a regional carbon forecast.
Answer like a voice assistant: lead with the time and the saving in one short sentence, then stop. Read times the way people say them ("one thirty a.m."). Never read out raw tables.
Use plan_appliance for "when should I run...", then schedule_run only when the person agrees (it saves the run; it does not switch anything on). Use get_tide for general "when is power cheap" questions (pass after: "18:00" for "tonight") and check_now for "is now a good time", with the appliance if they named one. Use get_tonight for "what's the plan for tonight?": once tomorrow's prices are out it has already planned the household's usual appliances for the night.`;

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

/** Wraps a tool callback so every call writes one structured log line (name, time, outcome; never the arguments). */
function logged<F extends (...args: never[]) => unknown>(name: string, ctx: Ctx, fn: F): F {
  return (async (...args: never[]) => {
    const t0 = Date.now();
    try {
      const out = (await fn(...args)) as { isError?: boolean } | undefined;
      log({ evt: "tool", tool: name, ms: Date.now() - t0, ok: !out?.isError, home: Boolean(ctx.homeId) });
      return out;
    } catch (e) {
      log({ evt: "tool", tool: name, ms: Date.now() - t0, ok: false, home: Boolean(ctx.homeId), error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }) as unknown as F;
}

export function registerLowtide(server: McpServer, ctx: Ctx) {
  // Every view tool also carries Alexa+'s status strings (_meta.ui.invoking / invoked, from Amazon's MCP Toolkit
  // client-lifecycle sample), on its definition and on each successful result. Hosts that don't know them ignore them.
  const appTool = ((srv: McpServer, name: string, config: { _meta?: { ui?: Record<string, unknown> } }, cb: (...args: never[]) => unknown) => {
    const status = STATUS[name];
    const meta = status ? { ...config._meta, ui: { ...config._meta?.ui, ...status } } : config._meta;
    const withStatus = (async (...args: never[]) => {
      const out = (await cb(...args)) as { isError?: boolean; _meta?: Record<string, unknown> } | undefined;
      if (out && status && !out.isError && !("resultType" in out) && !("inputRequests" in out)) out._meta = { ...out._meta, ui: { resourceUri: VIEW_URI, ...status } };
      return out;
    }) as typeof cb;
    return registerAppTool(srv as never, name, { ...config, _meta: meta } as never, logged(name, ctx, withStatus) as never);
  }) as unknown as typeof registerAppTool;
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

  appTool(
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: ui,
    },
    async ({ place, after }) => {
      const { tide } = await tideFor(ctx, place);
      const tz = tide.region.timeZone;
      const now = Date.now();
      const from = after ? nextClockTimeOrThrow(after, tz, now) : null;
      // "Tonight" starts at the asked hour, or now if that hour has already begun.
      const window = from && from - now < 20 * 3600_000 ? tide.slots.filter((s) => s.end > from) : tide.slots;
      // Half hour against half hour, so "cheapest" is never dearer than "now"; when this half hour is the cheapest, it says now.
      const { low, high } = cheapAndDear(window.length >= 1 ? window : tide.slots, now, 48);
      const cur = currentSlot(tide.slots, now);
      const when = (m: Mark) => (m.isNow ? "now" : clock(m.start, tz));
      const headline = low ? (low.isNow ? "Cheapest right now" : `Cheapest at ${clock(low.start, tz)} ${shortDay(low.start, now, tz)}`) : "Prices are flat for now";
      const sub = low && high
        ? `${rate(low.avgPrice, tide.region)} ${low.isNow ? "this half hour" : "then"}, against ${rate(high.avgPrice, tide.region)} at ${clock(high.start, tz)}${cur && !low.isNow ? `. Now: ${rate(cur.price, tide.region)}` : ""}.`
        : "";
      const facts = [
        ...(cur ? [{ label: "Now", value: rate(cur.price, tide.region) }] : []),
        ...(low ? [{ label: "Cheapest half hour", value: `${when(low)}, ${rate(low.avgPrice, tide.region)}` }] : []),
        ...(high ? [{ label: "Dearest half hour", value: `${when(high)}, ${rate(high.avgPrice, tide.region)}` }] : []),
        ...greenFact(tide),
      ];
      const view = viewOf("tide", tide, headline, sub, facts, [], now);
      const spoken = low && high
        ? low.isNow
          ? `Electricity in ${spokenPlace(tide.region)} is cheapest right now, at ${spokenRate(low.avgPrice, tide.region)} a unit, and dearest around ${spokenTime(high.start, tz)} at ${spokenRate(high.avgPrice, tide.region)}.`
          : `Electricity in ${spokenPlace(tide.region)} is cheapest ${dayPart(low.start, now, tz)} around ${spokenTime(low.start, tz)}, at ${spokenRate(low.avgPrice, tide.region)} a unit, and dearest around ${spokenTime(high.start, tz)} at ${spokenRate(high.avgPrice, tide.region)}.${cur ? ` Right now it's ${spokenRate(cur.price, tide.region)}.` : ""}`
        : "Prices are flat at the moment.";
      // Before the next day's prices are out, say how far the published day reaches.
      const last = tide.slots[tide.slots.length - 1]?.end ?? now;
      return result(last - now < 12 * 3600_000 ? `${spoken} Prices after ${spokenTime(last, tz)} aren't out yet; tomorrow's come out ${publishedWhen(tide.region)}.` : spoken, view);
    },
  );

  appTool(
    server,
    "check_now",
    {
      title: "Is now a good time to use power?",
      description: "Whether right now is a cheap or expensive (and clean or dirty) time to use electricity, compared with the rest of the published day, and how long until it gets cheaper.",
      inputSchema: z.object({
        place: placeArg,
        appliance: z.string().min(2).max(40).optional().describe("What they want to switch on now, e.g. tumble dryer, so the answer compares its cost now with the cheapest later start"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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

  appTool(
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
        finish_by: z
          .string()
          .max(30)
          .optional()
          .describe(
            "When it must be done by, in the person's own words: 'seven', '7am', '7 p.m.', '19:00', 'in two hours', '7am tomorrow'. Don't add a.m. or p.m. if they didn't say it: Lowtide picks the next seven the run can still make.",
          ),
        start_after: z.string().max(30).optional().describe("Only if the person said a start time: when it can't start before, in their words, e.g. 'ten', '22:00', 'after 10pm'"),
        goal: z.enum(["cheapest", "greenest", "balanced"]).optional().describe("Default cheapest"),
        kwh: z.number().min(0.1).max(100).optional().describe("Energy needed, e.g. 20 for an EV top-up"),
        minutes: z.number().int().min(15).max(720).optional(),
        place: placeArg,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: ui,
    },
    async (args) => {
      const { tide, state } = await tideFor(ctx, args.place);
      const tz = tide.region.timeZone;
      const now = Date.now();
      const app = applianceOrThrow(args.appliance);
      const { kwh, minutes } = loadFor(app, state, args.kwh, args.minutes);
      return planAppliance(tide, app, { kwh, minutes }, { finish_by: args.finish_by, start_after: args.start_after, goal: args.goal as Goal | undefined }, now);
    },
  );

  appTool(
    server,
    "schedule_run",
    {
      title: "Schedule an appliance run",
      description:
        "Saves a planned run for the household (after plan_appliance and the person's agreement) so it shows in list_runs and counts toward the household's savings. Lowtide does not send reminders; the person sets the machine's delay start. Pass the start time plan_appliance chose.",
      inputSchema: z.object({
        appliance: z.string().min(2).max(40),
        start: z.string().max(40).describe("Start time: the ISO time from plan_appliance, or a local clock time like '01:30'"),
        kwh: z.number().min(0.1).max(100).optional(),
        minutes: z.number().int().min(15).max(720).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args, extra) => {
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
      // When the host can show a form (MCP elicitation), the person confirms there, not only through the model.
      // Hosts without elicitation keep the spoken "yes" the model already heard.
      if (canElicit(server, extra)) {
        const answer = inputResponse(extraInputs(extra), "save");
        if (answer.kind === "missing") {
          const saving = ifNow ? ifNow.cost - run.cost : 0;
          return inputRequired({
            inputRequests: {
              save: inputRequired.elicit({
                message: `Save the ${app.name} for ${spokenTime(run.start, tz)} ${dayPart(run.start, now, tz)}? It costs about ${money(run.cost, tide.region)}${saving >= 1 ? `, ${money(saving, tide.region)} less than starting now` : ""}.`,
                requestedSchema: SAVE_FORM,
              }),
            },
          });
        }
        if (!(answer.kind === "elicit" && answer.action === "accept" && answer.content?.save === true)) {
          const view = viewOf("runs", tide, "Not saved", `The ${app.name} isn't saved. Ask again whenever you like.`, [], [], now);
          return result("Okay, I won't save it.", view);
        }
      }
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
      const sub = `Saved for ${clock(run.start, tz)} ${dayPart(run.start, now, tz)}${saved.costIfNow == null ? "" : saved.costIfNow - saved.cost >= 0.5 ? `, saving ${money(saved.costIfNow - saved.cost, tide.region)} on starting now` : saved.costIfNow - saved.cost <= -0.5 ? `, ${money(saved.cost - saved.costIfNow, tide.region)} more than starting now` : ""}. Set the delay start, or ask me what's planned.`;
      const berths = upcoming.map((r) => ({ start: r.start, end: r.end, label: r.label, state: r.id === saved.id ? ("best" as const) : ("planned" as const) }));
      const view = viewOf("scheduled", tide, headline, sub, runFacts(tide, saved), berths, now);
      const spoken = `Saved. ${cap(app.action)} ${dayPart(run.start, now, tz)} at ${spokenTime(run.start, tz)}.${saved.costIfNow != null && saved.costIfNow - saved.cost >= 1 ? ` That saves ${moneySpoken(saved.costIfNow - saved.cost, tide.region)}.` : ""}`;
      return result(spoken, view);
    },
  );

  appTool(
    server,
    "list_runs",
    {
      title: "Planned appliance runs",
      description: "The household's upcoming planned runs (and the last few finished ones) with their cost and saving.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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

  appTool(
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

  appTool(
    server,
    "get_savings",
    {
      title: "Money and carbon saved",
      description: "How much the household has saved by running appliances at the cheapest time instead of when they asked, this week and in total.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
    logged("set_home", ctx, async ({ place, name }: { place: string; name?: string }) => {
      const id = requireHome(ctx);
      const tide = await getTide(place); // validates the place before saving it
      await updateHome(id, (s) => {
        s.home.place = place;
        s.home.country = tide.region.country;
        if (name) s.home.name = name;
      });
      return { content: [{ type: "text" as const, text: `Got it. You're on ${tide.region.tariff} in ${tide.region.name}.` }] };
    }),
  );

  appTool(
    server,
    "get_tonight",
    {
      title: "Tonight's plan",
      description:
        "The plan for the coming night (18:00 to 08:00): the best start tonight for each appliance the household usually runs, and whether tonight is unusually cheap. Lowtide plans it once a night as soon as tomorrow's prices are published (Octopus Agile: about 4 p.m. UK time), so it's ready before anyone asks. Read-only; use schedule_run to save one of the runs if the person wants.",
      inputSchema: z.object({ place: placeArg }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: ui,
    },
    async ({ place }) => {
      const now = Date.now();
      let plan: TonightPlan | null;
      let ready: boolean;
      if (ctx.homeId && !place) ({ plan, ready } = await tonightForHome(ctx.homeId));
      else {
        if (!place && !ctx.homeId) throw new Error("Which postcode or city are you in? Lowtide covers Britain, northern Illinois and Germany.");
        ({ plan, ready } = await tonightForPlace(place!));
      }
      const { tide } = await tideFor(ctx, place);
      const tz = tide.region.timeZone;
      if (!plan) {
        const when = publishedWhen(tide.region);
        const view = viewOf("tide", tide, "Tonight's plan isn't ready yet", `Tomorrow's prices come out ${when}${when.endsWith(".") ? "" : "."}`, [], [], now);
        return result(`Tonight's plan isn't ready yet: tomorrow's prices come out ${when}. Ask me again then.`, view);
      }
      const facts = plan.items.slice(0, 4).map((i) => ({
        label: `${cap(i.label)} ${clock(i.start, tz)}`,
        value: `${money(i.cost, tide.region)}${i.typical != null && i.typical - i.cost >= 1 ? `, saves ${money(i.typical - i.cost, tide.region)}` : ""}`,
      }));
      const berths: ViewData["berths"] = plan.items.map((i, k) => ({ start: i.start, end: i.end, label: i.label, state: k === 0 ? "best" : "alt" }));
      const sub = `Planned ${ready ? "at" : "last night at"} ${clock(plan.computedAt, tz)} from tomorrow's published prices, against a typical start.`;
      const view = viewOf("plan", tide, plan.headline, sub, facts, berths, now);
      const r = result(plan.sentence, view);
      const first = plan.items[0];
      r.content.push({ type: "text" as const, text: `For schedule_run, pass appliance "${first.label}" and start "${new Date(first.start).toISOString()}". Don't read this line aloud.` });
      return r;
    },
  );

  if (ctx.homeId) {
    const homeId = ctx.homeId;
    server.registerResource(
      "Tonight's plan",
      TONIGHT_URI,
      { mimeType: "application/json", description: "The household's plan for the coming night, computed once a night after tomorrow's prices are published." },
      async () => {
        const { plan, ready } = await tonightForHome(homeId);
        return { contents: [{ uri: TONIGHT_URI, mimeType: "application/json", text: JSON.stringify({ ready, plan }) }] };
      },
    );
  }
}

/* ---------- helpers ---------- */

/** What an Alexa+ device shows while a tool runs and once it has answered (_meta.ui.invoking / invoked). */
export const STATUS: Record<string, { invoking: string; invoked: string }> = {
  get_tide: { invoking: "Reading today's electricity prices…", invoked: "Prices for the next day" },
  check_now: { invoking: "Checking this half hour's price…", invoked: "Checked the price now" },
  plan_appliance: { invoking: "Pricing every start time…", invoked: "Found the best start" },
  schedule_run: { invoking: "Saving the run…", invoked: "Run saved" },
  list_runs: { invoking: "Looking up your planned runs…", invoked: "Your planned runs" },
  cancel_run: { invoking: "Cancelling the run…", invoked: "Run cancelled" },
  get_savings: { invoking: "Adding up your savings…", invoked: "Your savings" },
  get_tonight: { invoking: "Reading tonight's plan…", invoked: "Tonight's plan" },
};

/** The one-question form schedule_run shows on hosts that support MCP elicitation (form mode). */
const SAVE_FORM = {
  type: "object" as const,
  properties: { save: { type: "boolean" as const, title: "Save this run", description: "Lowtide keeps it in your plan and counts the saving.", default: true } },
  required: ["save"],
};

type ExtraLike = { mcpReq?: { envelope?: Record<string, unknown>; inputResponses?: Record<string, unknown> } } | undefined;

/**
 * Whether this request's client declared form elicitation: on the 2026-07-28 protocol from the request's own
 * `_meta` envelope, on the 2025 protocol from what it declared at initialize (a stateless 2025 request has no
 * such record, so it falls back to the model's spoken confirmation).
 */
function canElicit(server: McpServer, extra: unknown): boolean {
  const env = (extra as ExtraLike)?.mcpReq?.envelope;
  type Caps = { elicitation?: Record<string, unknown> } | undefined;
  const modern = env?.["io.modelcontextprotocol/clientCapabilities"] as Caps;
  let caps: Caps = modern;
  if (!caps) {
    try {
      caps = (server as unknown as { server?: { getClientCapabilities?: () => Caps } }).server?.getClientCapabilities?.();
    } catch {
      caps = undefined;
    }
  }
  const e = caps?.elicitation;
  return Boolean(e && (Object.keys(e).length === 0 || "form" in e));
}

const extraInputs = (extra: unknown) => (extra as ExtraLike)?.mcpReq?.inputResponses;

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

function deadlineOrThrow(s: string, tz: string, now: number, minutes: number): Deadline {
  const d = resolveDeadline(s, tz, now, minutes);
  if (d === null) throw new Error(`I couldn't read "${s}" as a time. Try something like 7am, seven or in two hours.`);
  return d;
}

/**
 * plan_appliance's answer for one load. "Done by seven" with no a.m. or p.m. is the next seven the run can still
 * make (7 p.m. asked at 2 p.m. for a three-hour dishwasher; 7 a.m. tomorrow asked at 6:30 p.m.). A time the person
 * pinned down ("7am", "19:00", "in ten minutes") is never moved: if the run can't make it, the answer says so and
 * offers the earliest finish.
 */
export function planAppliance(
  tide: Tide,
  app: Appliance,
  load: { kwh: number; minutes: number },
  args: { finish_by?: string; start_after?: string; goal?: Goal },
  now: number,
) {
  const tz = tide.region.timeZone;
  const { kwh, minutes } = load;
  const deadline = args.finish_by ? deadlineOrThrow(args.finish_by, tz, now, minutes) : undefined;
  const finishBy = deadline?.at;
  let earliest = args.start_after ? deadlineOrThrow(args.start_after, tz, now, 0).at : undefined;
  // "After ten, done by seven", asked after ten at night: the window has already opened.
  if (earliest && finishBy && earliest >= finishBy) earliest = Math.max(now, earliest - 86_400_000);
  if (deadline && finishBy! - Math.max(now, earliest ?? now) < minutes * 60_000 && !(earliest && earliest > now)) {
    return tooLateResult(tide, app, kwh, minutes, deadline, now);
  }
  const plan = planRun(tide.slots, { kwh, minutes, goal: args.goal ?? "cheapest", finishBy, earliest, now });
  return planResult(tide, app, plan, now, deadline);
}

/** When the next day's prices come out, as Alexa would say it. */
export function publishedWhen(region: Pick<Region, "country">): string {
  return region.country === "GB" ? "around 4 p.m." : region.country === "DE" ? "early in the afternoon, German time" : "in the evening, Chicago time";
}

/** "3 hours", "2 and a half hours", "45 minutes", "1 hour 15 minutes". */
export function spokenDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} minutes`;
  if (m === 30) return `${h} and a half hours`;
  const hours = `${h} ${h === 1 ? "hour" : "hours"}`;
  return m ? `${hours} ${m} minutes` : hours;
}

/**
 * The deadline can't be met even starting now: say so, and offer the earliest finish (starting now) instead of
 * quietly moving the deadline to tomorrow.
 */
export function tooLateResult(tide: Tide, app: Appliance, kwh: number, minutes: number, deadline: Deadline, now: number) {
  const tz = tide.region.timeZone;
  const end = now + minutes * 60_000;
  const nowRun = costRun(tide.slots, now, minutes, kwh);
  const headline = `Can't be done by ${clock(deadline.at, tz)}`;
  const sub = `It takes ${duration(minutes)}: starting now, it's done at ${clock(end, tz)}${nowRun ? `, for ${money(nowRun.cost, tide.region)}` : ""}.`;
  const facts = [
    { label: "Deadline", value: `${clock(deadline.at, tz)} ${shortDay(deadline.at, now, tz)}` },
    { label: "Earliest finish", value: `${clock(end, tz)}, starting now` },
    ...(nowRun ? [{ label: "If started now", value: money(nowRun.cost, tide.region) }] : []),
    { label: "Load", value: `${kwh} kWh over ${duration(minutes)}` },
  ];
  const berths: ViewData["berths"] = [{ start: now, end, label: app.name, state: "now" }];
  const view = viewOf("plan", tide, headline, sub, facts, berths, now);
  let spoken = `The ${app.name} takes ${spokenDuration(minutes)}, so it can't be done by ${spokenTime(deadline.at, tz)}. Starting now, it would finish at ${spokenTime(end, tz)}${nowRun ? `, for about ${moneySpoken(nowRun.cost, tide.region)}` : ""}.`;
  if (!deadline.relative && !deadline.ambiguous) spoken += ` Or I can plan it for ${spokenTime(deadline.at, tz)} tomorrow.`;
  const r = result(spoken, view);
  r.content.push({ type: "text" as const, text: `If they want it started now, for schedule_run pass start "${new Date(now).toISOString()}" and minutes ${minutes}. Don't read this line aloud.` });
  return r;
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

/** How much less carbon `pick` emits than starting now, in whole percent; null without both forecasts. */
function carbonCut(nowRun: Run | null, pick: Run): number | null {
  if (!nowRun || nowRun.carbon == null || pick.carbon == null || nowRun.carbon <= 0 || nowRun.start === pick.start) return null;
  if (pick.carbon >= nowRun.carbon) return null; // not cleaner: nothing to claim
  return Math.max(0, Math.round((1 - pick.carbon / nowRun.carbon) * 100));
}

export function planResult(tide: Tide, app: Appliance, plan: Plan, now: number, deadline?: Deadline) {
  const tz = tide.region.timeZone;
  const b = plan.best;
  const startsNow = b.start - now < 5 * 60_000;
  // Which goal actually decided the start: greenest and balanced fall back to price where no carbon is published.
  const green = plan.goal !== "cheapest" && plan.greenest !== null;
  // Against starting now: positive is a saving, negative means the pick costs more (only a greener goal does that).
  const vsNowCost = plan.now && !startsNow ? plan.now.cost - b.cost : 0;
  const cut = carbonCut(plan.now, b);
  const headline = startsNow ? `${cap(app.action)} now` : `${cap(app.action)} at ${clock(b.start, tz)}`;
  const m = (x: number) => money(x, tide.region);
  const vsNow =
    !plan.now || startsNow
      ? `, ${m(b.cost)}`
      : vsNowCost >= 0.5 && m(b.cost) !== m(plan.now.cost)
        ? `, ${m(b.cost)} instead of ${m(plan.now.cost)} now${green && cut !== null ? `, ${cut >= 1 ? `${cut}%` : "a little"} less CO₂` : ""}`
        : vsNowCost <= -0.5 && m(b.cost) !== m(plan.now.cost)
          ? `, ${m(b.cost)}: ${m(-vsNowCost)} more than now${cut !== null ? ` for ${cut >= 1 ? `${cut}%` : "a little"} less CO₂` : ""}`
          : `, ${m(b.cost)}, about the same as now`;
  const sub = `${duration(plan.minutes)}, done by ${clock(b.end, tz)}${deadline ? ` (deadline ${clock(deadline.at, tz)})` : ""}${vsNow}.`;
  const facts = [
    { label: "Start", value: `${clock(b.start, tz)} ${dayPart(b.start, now, tz)}` },
    ...(deadline ? [{ label: "Done by", value: `${clock(b.end, tz)}, deadline ${clock(deadline.at, tz)} ${shortDay(deadline.at, now, tz)}` }] : []),
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
  const say = (x: number) => moneySpoken(x, tide.region);
  const less = cut === null ? "" : cut >= 1 ? `${cut}% less carbon` : "a little less carbon";
  // The deadline, said back, so "done by seven" is visibly honoured.
  const inTime = deadline ? `in time for ${spokenTime(deadline.at, tz)} ${dayPart(deadline.at, now, tz)}` : "";
  let spoken: string;
  if (startsNow) {
    const why = !green ? "the cheapest" : plan.goal === "greenest" ? "the cleanest" : "the best balance of price and carbon";
    spoken = `Now's ${why} time to ${app.action}: about ${say(b.cost)}.`;
    if (deadline) spoken += ` It'll be done by ${spokenTime(b.end, tz)}, ${inTime}.`;
  } else {
    const why = !green ? "" : plan.goal === "greenest" ? ", the cleanest start" : ", the best balance of price and carbon";
    let cost = `It costs about ${say(b.cost)}`;
    if (vsNowCost >= 1) cost += `, ${say(vsNowCost)} less than starting now${green && cut !== null ? `, with ${less}` : ""}`;
    else if (vsNowCost <= -1) cost += `, about ${say(-vsNowCost)} more than starting now${cut !== null ? `, but ${less}` : ""}`;
    else if (plan.now && green && cut !== null) cost += `, about the same as starting now, with ${less}`;
    const done = deadline ? `, done by ${spokenTime(b.end, tz)}, ${inTime}` : "";
    spoken = `${cap(app.action)} ${dayPart(b.start, now, tz)} at ${spokenTime(b.start, tz)}${why}${done}. ${cost}.`;
  }
  if (plan.greenest && plan.goal === "cheapest" && plan.greenest.start !== b.start && b.carbon != null) {
    spoken += ` The cleanest start would be ${spokenTime(plan.greenest.start, tz)}.`;
  }
  // A greener pick that costs noticeably more than the cheapest start: say what the cheapest would have been.
  if (green && plan.cheapest.start !== b.start && b.cost - plan.cheapest.cost >= 1) {
    const at = plan.now && plan.cheapest.start === plan.now.start ? "now" : `at ${spokenTime(plan.cheapest.start, tz)}`;
    if (!(at === "now" && vsNowCost <= -1)) spoken += ` The cheapest start is ${at}, ${say(b.cost - plan.cheapest.cost)} less.`;
  }
  if (plan.goal !== "cheapest" && !plan.greenest) spoken += " There's no carbon forecast here, so I went by price.";
  // Before the next day's prices are out (Agile: about 4 p.m.), the plan can only use what's published.
  const short = deadline ? deadline.at > plan.horizonEnd + 60_000 : plan.horizonEnd - now < 12 * 3600_000;
  if (short) spoken += ` Prices after ${spokenTime(plan.horizonEnd, tz)} aren't out yet; tomorrow's come out ${publishedWhen(tide.region)}.`;
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
    ...(r.costIfNow != null
      ? [r.costIfNow - r.cost >= 0 ? { label: "Saving", value: money(r.costIfNow - r.cost, tide.region) } : { label: "More than now", value: money(r.cost - r.costIfNow, tide.region) }]
      : []),
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
  const { low, high } = cheapAndDear(tide.slots.filter((s) => s.start < horizon), now, 48);
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
