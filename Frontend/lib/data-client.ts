export type Primitive = string | number | boolean | null | undefined;

export type KeyQueryValue = Primitive | Primitive[];

export interface CacheKeyParts {
  namespace?: string;
  version?: string;
  tenantId?: string | null;
  userId?: string | null;
  method?: string;
  path: string;
  query?: Record<string, KeyQueryValue>;
  body?: unknown;
}

export interface CachePolicy {
  ttlMs?: number;
  swrMs?: number;
  swr?: boolean;
}

export interface QueryOptions<T> extends CachePolicy {
  forceRefresh?: boolean;
  skipCache?: boolean;
  onUpdate?: (value: T) => void;
  onError?: (error: unknown) => void;
}

export interface QueryResult<T> {
  data: T;
  fromCache: boolean;
  stale: boolean;
  revalidating: boolean;
}

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  staleUntil: number;
}

const DEFAULT_POLICY: Required<CachePolicy> = {
  ttlMs: 60_000,
  swrMs: 120_000,
  swr: true,
};

function normalizeMethod(method?: string): string {
  return (method || "GET").toUpperCase();
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${pairs.join(",")}}`;
}

function simpleHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeQuery(query?: Record<string, KeyQueryValue>): string {
  if (!query) return "";

  const keys = Object.keys(query)
    .filter((key) => query[key] !== undefined)
    .sort();

  if (!keys.length) return "";

  const parts: string[] = [];
  for (const key of keys) {
    const rawValue = query[key];

    if (Array.isArray(rawValue)) {
      const values = rawValue
        .filter((value) => value !== undefined)
        .map((value) => String(value));
      values.sort();
      for (const value of values) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
      continue;
    }

    if (rawValue === null) {
      parts.push(`${encodeURIComponent(key)}=null`);
      continue;
    }

    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(rawValue))}`);
  }

  return parts.join("&");
}

export function buildCacheKey(parts: CacheKeyParts): string {
  const namespace = parts.namespace || "api";
  const version = parts.version || "v1";
  const tenant = parts.tenantId || "public";
  const user = parts.userId || "anon";
  const method = normalizeMethod(parts.method);
  const path = normalizePath(parts.path);
  const query = normalizeQuery(parts.query);
  const bodyHash = parts.body === undefined ? "" : simpleHash(stableStringify(parts.body));

  const keySections = [
    version,
    namespace,
    `tenant:${tenant}`,
    `user:${user}`,
    method,
    path,
    query ? `q:${query}` : "",
    bodyHash ? `b:${bodyHash}` : "",
  ].filter(Boolean);

  return keySections.join("|");
}

export class DataClient {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  getCached<T>(key: string): CacheEntry<T> | undefined {
    return this.cache.get(key) as CacheEntry<T> | undefined;
  }

  setCached<T>(key: string, value: T, policy?: CachePolicy): CacheEntry<T> {
    const merged = { ...DEFAULT_POLICY, ...policy };
    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + merged.ttlMs,
      staleUntil: now + merged.ttlMs + merged.swrMs,
    };
    this.cache.set(key, entry);
    return entry;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  async query<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: QueryOptions<T>,
  ): Promise<QueryResult<T>> {
    const merged = { ...DEFAULT_POLICY, ...options };
    const now = Date.now();

    if (merged.skipCache) {
      const data = await this.fetchAndCache(key, fetcher, merged);
      return { data, fromCache: false, stale: false, revalidating: false };
    }

    const cached = this.getCached<T>(key);

    if (cached && !merged.forceRefresh) {
      if (now < cached.expiresAt) {
        return {
          data: cached.value,
          fromCache: true,
          stale: false,
          revalidating: false,
        };
      }

      const canServeStale = merged.swr && now < cached.staleUntil;
      if (canServeStale) {
        this.revalidateInBackground(key, fetcher, merged);
        return {
          data: cached.value,
          fromCache: true,
          stale: true,
          revalidating: true,
        };
      }
    }

    const data = await this.fetchAndCache(key, fetcher, merged);
    return {
      data,
      fromCache: false,
      stale: false,
      revalidating: false,
    };
  }

  private revalidateInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: QueryOptions<T>,
  ): void {
    const existing = this.inFlight.get(key);
    if (existing) return;

    const request = fetcher()
      .then((value) => {
        this.setCached(key, value, options);
        if (options.onUpdate) {
          options.onUpdate(value);
        }
        return value;
      })
      .catch((error) => {
        if (options.onError) {
          options.onError(error);
        }
        return undefined;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
  }

  private async fetchAndCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: QueryOptions<T>,
  ): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const request = fetcher()
      .then((value) => {
        this.setCached(key, value, options);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
    return request;
  }
}

export const sharedDataClient = new DataClient();

export function createCacheKey(parts: CacheKeyParts): string {
  return buildCacheKey(parts);
}
