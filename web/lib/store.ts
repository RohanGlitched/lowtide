import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Country, Home } from "./grid/types";
import { storage } from "./storage";

export interface ScheduledRun {
  id: string;
  appliance: string; // appliance id
  label: string; // "dishwasher"
  start: number;
  end: number;
  kwh: number;
  cost: number; // minor units at the chosen time
  costIfNow: number | null; // minor units had it started when planned
  carbon: number | null; // grams
  carbonIfNow: number | null;
  createdAt: number;
  status: "planned" | "cancelled";
}

export interface HomeState {
  home: Home;
  runs: ScheduledRun[];
  overrides: Record<string, { kwh?: number; minutes?: number }>;
}

/**
 * One JSON document per household. In production it is an object in the configured store (Google Cloud
 * Storage or Vercel Blob) read from origin and written with a version check, so two quick writes can't silently
 * overwrite each other. Locally, without a store, it is a file under .data/.
 */
const useBlob = () => storage() !== null;
const LOCAL_DIR = path.join(process.cwd(), ".data");
const key = (id: string) => `homes/${id}.json`;

export const HOME_ID = /^[a-z2-7]{10}$/;

export function newHomeId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b & 31]).join("");
}

async function read(id: string): Promise<{ state: HomeState; etag?: string } | null> {
  if (!HOME_ID.test(id)) return null;
  if (!useBlob()) {
    try {
      return { state: JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${id}.json`), "utf8")) };
    } catch {
      return null;
    }
  }
  const r = await storage()!.read(key(id)).catch(() => null);
  if (!r) return null;
  return { state: JSON.parse(r.text) as HomeState, etag: r.etag };
}

async function write(id: string, state: HomeState, etag?: string): Promise<void> {
  if (!useBlob()) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, `${id}.json`), JSON.stringify(state, null, 2));
    return;
  }
  await storage()!.write(key(id), JSON.stringify(state), { ifMatch: etag });
}

export async function loadHome(id: string): Promise<HomeState | null> {
  return (await read(id))?.state ?? null;
}

export async function createHome(place: string, country: Country, name?: string, runs: ScheduledRun[] = []): Promise<HomeState> {
  const id = newHomeId();
  const state: HomeState = {
    home: { id, place, country, name, createdAt: Date.now() },
    runs,
    overrides: {},
  };
  await write(id, state);
  return state;
}

/**
 * Read-modify-write guarded by the blob's ETag on every attempt. Blob ETags can lag for a moment right
 * after an overwrite, so a mismatch is re-read and retried with a short backoff; if it still mismatches
 * the caller hears "try again" rather than silently overwriting someone else's save.
 */
export async function updateHome(id: string, change: (s: HomeState) => HomeState | void): Promise<HomeState> {
  const ATTEMPTS = 5;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const cur = await read(id);
    if (!cur) throw new Error("This Lowtide link doesn't match a household. Get a new one on the Lowtide website.");
    const draft = structuredClone(cur.state);
    const next = change(draft) ?? draft;
    try {
      await write(id, next, cur.etag);
      return next;
    } catch (e) {
      if (!/etag|precondition|changed since/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw new Error("Couldn't save just now. Try again in a moment.");
}
