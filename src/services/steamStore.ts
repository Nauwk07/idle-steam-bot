export type SteamSearchResult = {
  id: number;
  name: string;
  tiny_image?: string;
};

type SteamStoreSearchResponse = {
  items?: SteamSearchResult[];
};

type SteamAppDetailsResponse = Record<
  string,
  {
    success?: boolean;
    data?: {
      name?: string;
    };
  }
>;

const APP_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 400;
const FETCH_TIMEOUT_MS = 5_000;

type CacheEntry<T> = { value: T; expiresAt: number };

const appNameCache = new Map<number, CacheEntry<string | null>>();
const searchCache = new Map<string, CacheEntry<SteamSearchResult[]>>();

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok) return response;
        if (response.status < 500 && response.status !== 429) return response;
        lastError = new Error(`HTTP ${response.status}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < RETRY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function readCache<K, V>(cache: Map<K, CacheEntry<V>>, key: K): V | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeCache<K, V>(cache: Map<K, CacheEntry<V>>, key: K, value: V, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function searchSteamStore(query: string): Promise<SteamSearchResult[]> {
  const key = query.trim().toLowerCase();
  const cached = readCache(searchCache, key);
  if (cached) return cached;

  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.searchParams.set("term", query);
  url.searchParams.set("l", "french");
  url.searchParams.set("cc", "FR");

  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`Recherche Steam échouée: HTTP ${response.status}`);

  const body = (await response.json()) as SteamStoreSearchResponse;
  const results = (body.items ?? []).slice(0, 8);
  writeCache(searchCache, key, results, SEARCH_CACHE_TTL_MS);
  return results;
}

export async function getSteamAppName(appId: number): Promise<string | null> {
  const cached = readCache(appNameCache, appId);
  if (cached !== undefined) return cached;

  const url = new URL("https://store.steampowered.com/api/appdetails/");
  url.searchParams.set("appids", String(appId));
  url.searchParams.set("filters", "basic");
  url.searchParams.set("l", "french");
  url.searchParams.set("cc", "FR");

  try {
    const response = await fetchWithRetry(url);
    if (!response.ok) return null;
    const body = (await response.json()) as SteamAppDetailsResponse;
    const item = body[String(appId)];
    const name = item?.success && item.data?.name ? item.data.name : null;
    writeCache(appNameCache, appId, name, APP_NAME_CACHE_TTL_MS);
    return name;
  } catch {
    return null;
  }
}
