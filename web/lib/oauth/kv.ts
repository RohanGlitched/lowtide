import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { storage } from "../storage";

/**
 * JSON records for the authorization server (clients, codes, grants, access tokens), kept next to the
 * households in the same store: the S3 bucket in production, read from origin and written with If-Match so
 * a code can be spent once and a refresh token rotated once even when two instances race. Without a store
 * (local development, tests) they are files under .data/oauth with a content hash as the version tag, and a
 * per-key lock stands in for the store's conditional write.
 *
 * Keys hold no secrets: tokens and client secrets are looked up by their SHA-256, never stored as issued.
 */
export type Versioned<T> = { value: T; etag?: string };

export class Conflict extends Error {
  constructor(key: string) {
    super(`${key}: changed since it was read`);
  }
}

const PREFIX = "oauth/";
/** .data/oauth/<kind>/<id> locally: the same layout as the bucket's oauth/ prefix. */
const localPath = (key: string) => path.join(process.cwd(), ".data", ...key.split("/"));
const tag = (text: string) => `"${createHash("sha256").update(text).digest("hex").slice(0, 32)}"`;

const locks = new Map<string, Promise<unknown>>();
async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

export async function getRecord<T>(key: string): Promise<Versioned<T> | null> {
  const k = PREFIX + key;
  const store = storage();
  if (store) {
    const r = await store.read(k);
    return r ? { value: JSON.parse(r.text) as T, etag: r.etag } : null;
  }
  try {
    const text = await fs.readFile(localPath(k), "utf8");
    return { value: JSON.parse(text) as T, etag: tag(text) };
  } catch {
    return null;
  }
}

/** Writes a record; with `ifMatch`, only if it is still the version that was read (throws Conflict otherwise). */
export async function putRecord<T>(key: string, value: T, ifMatch?: string): Promise<void> {
  const k = PREFIX + key;
  const text = JSON.stringify(value);
  const store = storage();
  if (store) {
    try {
      await store.write(k, text, { ifMatch });
    } catch (e) {
      if (/etag|precondition|changed since/i.test(String(e))) throw new Conflict(k);
      throw e;
    }
    return;
  }
  await locked(k, async () => {
    const file = localPath(k);
    if (ifMatch !== undefined) {
      const cur = await fs.readFile(file, "utf8").catch(() => null);
      if (cur === null || tag(cur) !== ifMatch) throw new Conflict(k);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  });
}

/**
 * Read-modify-write with the version check on every attempt. `change` returns the next value, or null to
 * leave the record as it is. Gives up after a few conflicts so a caller can answer "try again".
 */
export async function updateRecord<T>(key: string, change: (cur: T) => T | null, attempts = 4): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const cur = await getRecord<T>(key);
    if (!cur) return null;
    const next = change(structuredClone(cur.value));
    if (next === null) return cur.value;
    try {
      await putRecord(key, next, cur.etag);
      return next;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw new Conflict(PREFIX + key);
}
