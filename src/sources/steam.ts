import type { ItemData, SearchResult } from '../types';
import type { SomedaySettings } from '../settings';
import type { SourceAdapter } from './adapter';
import { getJson, HttpError } from './http';

interface StoreSearchResponse {
	items?: Array<{
		id: number;
		name: string;
		tiny_image?: string;
		type?: string;
	}>;
}

interface AppDetailsData {
	name: string;
	header_image?: string;
	short_description?: string;
	genres?: Array<{ description: string }>;
	release_date?: { date?: string };
	platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
}

type AppDetailsResponse = Record<
	string,
	{ success: boolean; data?: AppDetailsData }
>;

const STORE = 'https://store.steampowered.com';

/** `store.steampowered.com/app/238960/Path_of_Exile/` → `238960`. */
const APP_URL_RE = /(?:^|\/)app\/(\d+)/;
const DIGITS_RE = /^\d+$/;

/** Steam release dates are localised free text ("17 Mar, 2020"); take the year. */
function releaseYear(date?: string): number | undefined {
	const year = date?.match(/\b(\d{4})\b/)?.[1];
	return year !== undefined ? Number(year) : undefined;
}

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
	readonly idLabel = 'Steam app ID';
	readonly idHint = 'The number in a store URL: store.steampowered.com/app/239160/';
	readonly idPlaceholder = '239160 or store URL';

	constructor(private readonly getSettings: () => SomedaySettings) {}

	private region(): string {
		const s = this.getSettings();
		return `cc=${encodeURIComponent(s.steamCc)}&l=${encodeURIComponent(s.steamLang)}`;
	}

	async search(query: string): Promise<SearchResult[]> {
		const url = `${STORE}/api/storesearch/?term=${encodeURIComponent(query)}&${this.region()}`;
		const res = await getJson<StoreSearchResponse>(url);
		// storesearch mixes apps with packages ("sub") and bundles, which
		// /api/appdetails cannot resolve — drop everything that is not an app.
		return (res.items ?? [])
			.filter((item) => item.type === 'app')
			.map((item) => ({
				source: 'steam' as const,
				sourceId: String(item.id),
				title: item.name,
				thumb: item.tiny_image,
				subtitle: 'Game',
			}));
	}

	parseId(input: string): string | undefined {
		const raw = input.trim();
		return APP_URL_RE.exec(raw)?.[1] ?? (DIGITS_RE.test(raw) ? raw : undefined);
	}

	async lookupById(id: string): Promise<SearchResult[]> {
		const data = await this.appDetails(id);
		return [
			{
				source: 'steam' as const,
				sourceId: id,
				title: data.name,
				year: releaseYear(data.release_date?.date),
				thumb: data.header_image,
				subtitle: 'Game',
			},
		];
	}

	private async appDetails(appId: string): Promise<AppDetailsData> {
		const url = `${STORE}/api/appdetails?appids=${encodeURIComponent(appId)}&${this.region()}`;
		const res = await getJson<AppDetailsResponse>(url);
		const entry = res[appId];
		if (!entry || !entry.success || !entry.data) {
			throw new HttpError(0, `Steam returned no details for app ${appId}.`);
		}
		return entry.data;
	}

	async getDetails(sourceId: string): Promise<ItemData> {
		const data = await this.appDetails(sourceId);
		return {
			type: 'game',
			title: data.name,
			source: 'steam',
			sourceId,
			url: `${STORE}/app/${sourceId}`,
			cover: data.header_image,
			releaseDate: data.release_date?.date,
			platforms: platformList(data.platforms),
			description: data.short_description,
		};
	}
}
