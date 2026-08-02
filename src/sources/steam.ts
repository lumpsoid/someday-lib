import type { ItemData, SearchPage, SearchResult } from '../types';
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

/** The store search page returns its hits as rendered rows, not as data. */
interface StorePageResponse {
	results_html?: string;
	total_count?: number;
}

const STORE = 'https://store.steampowered.com';

/** `store.steampowered.com/app/238960/Path_of_Exile/` → `238960`. */
const APP_URL_RE = /(?:^|\/)app\/(\d+)/;
const DIGITS_RE = /^\d+$/;
/** Rows are keyed `App_440`, `Sub_124923` or `Bundle_…`; only apps resolve. */
const ITEM_KEY_RE = /^App_(\d+)$/;
/** What the store search page hands back per request. */
const STORE_PAGE_SIZE = 25;

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

/** Read the hits out of the store search page's rendered result rows. */
function parseStoreRows(html: string): SearchResult[] {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const results: SearchResult[] = [];
	for (const row of Array.from(doc.querySelectorAll('a.search_result_row'))) {
		const appId = ITEM_KEY_RE.exec(
			row.getAttribute('data-ds-itemkey') ?? '',
		)?.[1];
		const title = row.querySelector('.title')?.textContent?.trim();
		if (appId === undefined || !title) continue;
		results.push({
			source: 'steam',
			sourceId: appId,
			title,
			year: releaseYear(
				row.querySelector('.search_released')?.textContent ?? undefined,
			),
			thumb:
				row.querySelector('.search_capsule img')?.getAttribute('src') ??
				undefined,
			subtitle: 'Game',
		});
	}
	return results;
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

	/**
	 * storesearch gives the tightest matches but caps every query at ten hits
	 * and ignores paging arguments, so it can only ever be page one. Later pages
	 * restart the query against the store's own search page, which does
	 * paginate; its first rows repeat what page one showed, and the caller drops
	 * those.
	 */
	async search(query: string, page: number): Promise<SearchPage> {
		if (page > 1) {
			return this.searchStorePage(query, (page - 2) * STORE_PAGE_SIZE);
		}
		const url = `${STORE}/api/storesearch/?term=${encodeURIComponent(query)}&${this.region()}`;
		const res = await getJson<StoreSearchResponse>(url);
		// storesearch mixes apps with packages ("sub") and bundles, which
		// /api/appdetails cannot resolve — drop everything that is not an app.
		const results = (res.items ?? [])
			.filter((item) => item.type === 'app')
			.map((item) => ({
				source: 'steam' as const,
				sourceId: String(item.id),
				title: item.name,
				// The 231x87 capsule is all storesearch offers. Bigger art lives on
				// a per-asset hashed path that cannot be derived from this URL, and
				// only appdetails' heavyweight `basic` payload reports it.
				thumb: item.tiny_image,
				subtitle: 'Game',
			}));
		// A query that matched nothing here matches nothing on the store page
		// either; anything else is worth another page.
		return { results, hasMore: results.length > 0 };
	}

	/** One page of the store's search, starting at the `start`-th hit. */
	private async searchStorePage(
		query: string,
		start: number,
	): Promise<SearchPage> {
		// `infinite=1` is the store's own endless-scroll endpoint: JSON carrying
		// the rendered rows, with no data-only equivalent. category1=998 keeps it
		// to games, so DLC and soundtracks stay out of the list.
		const url =
			`${STORE}/search/results/?json=1&infinite=1&category1=998` +
			`&term=${encodeURIComponent(query)}&start=${start}&count=${STORE_PAGE_SIZE}&${this.region()}`;
		const res = await getJson<StorePageResponse>(url);
		return {
			results: parseStoreRows(res.results_html ?? ''),
			hasMore: start + STORE_PAGE_SIZE < (res.total_count ?? 0),
		};
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
