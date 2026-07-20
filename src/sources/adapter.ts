import type { ItemData, MediaType, SearchResult, Source } from '../types';
import type { SomedaySettings } from '../settings';
import { SteamAdapter } from './steam';
import { AniListAdapter } from './anilist';

/**
 * One upstream (Steam, AniList). A narrow port: search returns lightweight hits,
 * getDetails resolves one hit into a full ItemData. The media type is fixed per
 * source (Steam → game, AniList → anime).
 */
export interface SourceAdapter {
	readonly id: Source;
	readonly label: string;
	readonly type: MediaType;
	search(query: string): Promise<SearchResult[]>;
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
