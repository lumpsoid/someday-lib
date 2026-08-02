import type { ItemData, MediaType, SearchPage, SearchResult, Source } from '../types';
import type { SomedaySettings } from '../settings';
import { SteamAdapter } from './steam';
import { AniListAdapter } from './anilist';

/**
 * One upstream (Steam, AniList). A narrow port: search returns lightweight hits,
 * getDetails resolves one hit into a full ItemData. The media type is fixed per
 * source (Steam → game, AniList → anime).
 *
 * Title search is best-effort — upstream search endpoints miss delisted,
 * region-restricted and oddly-titled entries — so every adapter also resolves a
 * hit straight from its own id (`parseId` + `lookupById`).
 */
export interface SourceAdapter {
	readonly id: Source;
	readonly label: string;
	readonly type: MediaType;
	/** Field label for the by-id lookup, e.g. "Steam app ID". */
	readonly idLabel: string;
	/** Accepted forms, shown under the by-id field. */
	readonly idHint: string;
	readonly idPlaceholder: string;
	/**
	 * One page of hits for a title query. Pages are 1-based and each is meant to
	 * be appended to the ones before it, so an adapter may repeat a hit it
	 * already returned — the caller drops what it already lists.
	 */
	search(query: string, page: number): Promise<SearchPage>;
	/**
	 * Extract the upstream id from what the user typed — a bare id or a pasted
	 * page URL. Returns undefined when the input is not an id at all.
	 */
	parseId(input: string): string | undefined;
	/** Resolve one id into a hit, bypassing search. Empty when nothing matches. */
	lookupById(id: string): Promise<SearchResult[]>;
	getDetails(sourceId: string): Promise<ItemData>;
}

/**
 * Build the adapter registry. Adapters read live settings through the passed
 * getter, so changes in the settings tab take effect without rebuilding.
 */
export function createAdapters(
	getSettings: () => SomedaySettings,
): Record<Source, SourceAdapter> {
	return {
		steam: new SteamAdapter(getSettings),
		anilist: new AniListAdapter(getSettings),
	};
}
