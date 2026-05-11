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

export async function searchSteamStore(
  query: string,
): Promise<SteamSearchResult[]> {
  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.searchParams.set("term", query);
  url.searchParams.set("l", "french");
  url.searchParams.set("cc", "FR");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Recherche Steam échouée: HTTP ${response.status}`);
  }

  const body = (await response.json()) as SteamStoreSearchResponse;
  return (body.items ?? []).slice(0, 8);
}

export async function getSteamAppName(appId: number): Promise<string | null> {
  const url = new URL("https://store.steampowered.com/api/appdetails/");
  url.searchParams.set("appids", String(appId));
  url.searchParams.set("filters", "basic");
  url.searchParams.set("l", "french");
  url.searchParams.set("cc", "FR");

  const response = await fetch(url);
  if (!response.ok) return null;

  const body = (await response.json()) as SteamAppDetailsResponse;
  const item = body[String(appId)];
  return item?.success && item.data?.name ? item.data.name : null;
}
