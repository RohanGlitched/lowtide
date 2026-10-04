import "server-only";
import { get, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Country, Home } from "./grid/types";

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
 * One JSON document per household. In production it is a private Vercel Blob read from origin (no CDN
 * cache) and written with an ETag check, so two quick writes can't silently overwrite each other.
 * Locally, without a Blob token, it is a file under .data/.
 */
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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
  const r = await get(key(id), { access: "private", useCache: false }).catch(() => null);
  if (!r || !r.stream) return null;
  const text = await new Response(r.stream).text();
  return { state: JSON.parse(text) as HomeState, etag: r.blob.etag };
}

async function write(id: string, state: HomeState, etag?: string): Promise<void> {
  if (!useBlob()) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, `${id}.json`), JSON.stringify(state, null, 2));
    return;
  }
  await put(key(id), JSON.stringify(state), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  });
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
 * Read-modify-write guarded by the blob's ETag. Blob ETags can lag for a moment right after an overwrite,
 * so a mismatch is retried with a short backoff; the last attempt writes unconditionally (a household's
 * document has one writer at a time in practice, and losing the race is better than losing the run).
 */
export async function updateHome(id: string, change: (s: HomeState) => HomeState | void): Promise<HomeState> {
  const ATTEMPTS = 4;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const cur = await read(id);
    if (!cur) throw new Error("This Lowtide link doesn't match a household. Get a new one on the Lowtide website.");
    const draft = structuredClone(cur.state);
    const next = change(draft) ?? draft;
    try {
      await write(id, next, attempt < ATTEMPTS - 1 ? cur.etag : undefined);
      return next;
    } catch (e) {
      if (!/etag|precondition/i.test(String(e)) || attempt === ATTEMPTS - 1) throw e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw new Error("Couldn't save, try again.");
}
