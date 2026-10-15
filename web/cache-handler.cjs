// Next.js cache handler for the AWS Lambda build (NEXT_OUTPUT=standalone): ISR pages and fetch() data cached in
// memory per Lambda instance, because Lambda's file system is read-only outside /tmp. Bounded, so a busy
// instance can't grow without limit; a cold instance simply renders again (prices are cached by CloudFront too).
const MAX_ENTRIES = 400;
const cache = new Map();

module.exports = class MemoryCacheHandler {
  constructor(options) {
    this.options = options;
  }

  async get(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    // refresh its place in the LRU order
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  async set(key, data, ctx) {
    cache.delete(key);
    cache.set(key, { value: data, lastModified: Date.now(), tags: (ctx && ctx.tags) || [] });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }

  async revalidateTag(tags) {
    const list = [tags].flat();
    for (const [key, value] of cache) if (value.tags.some((t) => list.includes(t))) cache.delete(key);
  }

  resetRequestCache() {}
};
