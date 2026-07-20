import type { ItemData, SearchResult } from '../types';
import type { SomedaySettings } from '../settings';
import type { SourceAdapter } from './adapter';
import { getJson, HttpError } from './http';
import { percentScoreToRating } from '../model/rating';

interface StoreSearchResponse {
	items?: Array<{ id: number; name: string; tiny_image?: string }>;
}

interface AppDetailsData {
	name: string;
	header_image?: string;
	short_description?: string;
	genres?: Array<{ description: string }>;
	release_date?: { date?: string };
	platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
	metacritic?: { score?: number };
}

type AppDetailsResponse = Record<
	string,
	{ success: boolean; data?: AppDetailsData }
>;

const STORE = 'https://store.steampowered.com';

function platformList(p: AppDetailsData['platforms']): string[] | undefined {
	if (!p) return undefined;
	const list: string[] = [];
	if (p.windows) list.push('Windows');
	if (p.mac) list.push('macOS');
	if (p.linux) list.push('Linux');
	return list.length > 0 ? list : undefined;
}

export class SteamAdapter implements SourceAdapter {
	readonly id = 'steam' as const;
	readonly label = 'Steam';
	readonly type = 'game' as const;

	constructor(private readonly getSettings: () => SomedaySettings) {}

	private region(): string {
		const s = this.getSettings();
		return `cc=${encodeURIComponent(s.steamCc)}&l=${encodeURIComponent(s.steamLang)}`;
	}

	async search(query: string): Promise<SearchResult[]> {
		const url = `${STORE}/api/storesearch/?term=${encodeURIComponent(query)}&${this.region()}`;
		const res = await getJson<StoreSearchResponse>(url);
		return (res.items ?? []).map((item) => ({
			source: 'steam',
			sourceId: String(item.id),
			title: item.name,
			thumb: item.tiny_image,
			subtitle: 'Game',
		}));
	}

	async getDetails(sourceId: string): Promise<ItemData> {
		const url = `${STORE}/api/appdetails?appids=${encodeURIComponent(sourceId)}&${this.region()}`;
		const res = await getJson<AppDetailsResponse>(url);
		const entry = res[sourceId];
		if (!entry || !entry.success || !entry.data) {
			throw new HttpError(
				0,
				`Steam returned no details for app ${sourceId}.`,
			);
		}
		const data = entry.data;
		return {
			type: 'game',
			title: data.name,
			source: 'steam',
			sourceId,
			url: `${STORE}/app/${sourceId}`,
			cover: data.header_image,
			rating: percentScoreToRating(data.metacritic?.score),
			releaseDate: data.release_date?.date,
			platforms: platformList(data.platforms),
			description: data.short_description,
		};
	}
}
