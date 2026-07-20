import type { ItemData, SearchResult } from '../types';
import type { SomedaySettings, TitleLanguage } from '../settings';
import type { SourceAdapter } from './adapter';
import { postJson, HttpError } from './http';
import { percentScoreToRating } from '../model/rating';

const ENDPOINT = 'https://graphql.anilist.co';

const MEDIA_FIELDS = `
	id
	title { romaji english }
	coverImage { large }
	episodes
	format
	seasonYear
	averageScore
	description(asHtml: false)
	siteUrl
`;

// AniList treats `isAdult: null` as "match media whose isAdult IS null" (none),
// so to include adult results we must OMIT the argument entirely rather than
// pass null. The filter is only present when excluding adult titles.
const searchQuery = (includeAdult: boolean): string => `query ($q: String) {
	Page(perPage: 12) {
		media(search: $q, type: ANIME, sort: SEARCH_MATCH${
			includeAdult ? '' : ', isAdult: false'
		}) {${MEDIA_FIELDS}}
	}
}`;

const DETAILS_QUERY = `query ($id: Int) {
	Media(id: $id, type: ANIME) {${MEDIA_FIELDS}}
}`;

interface Media {
	id: number;
	title?: { romaji?: string; english?: string };
	coverImage?: { large?: string };
	episodes?: number;
	format?: string;
	seasonYear?: number;
	averageScore?: number;
	description?: string;
	siteUrl?: string;
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: Array<{ message: string }>;
}

const titleOf = (m: Media, prefer: TitleLanguage): string => {
	const romaji = m.title?.romaji;
	const english = m.title?.english;
	const [first, second] =
		prefer === 'romaji' ? [romaji, english] : [english, romaji];
	return first ?? second ?? `AniList #${m.id}`;
};

/** Remove the residual HTML tags AniList leaves in plain-text descriptions. */
const stripHtml = (html?: string): string | undefined => {
	if (!html) return undefined;
	const text = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.trim();
	return text.length > 0 ? text : undefined;
};

function toSearchResult(m: Media, prefer: TitleLanguage): SearchResult {
	const parts = [m.format, m.episodes ? `${m.episodes} eps` : undefined].filter(
		Boolean,
	);
	return {
		source: 'anilist',
		sourceId: String(m.id),
		title: titleOf(m, prefer),
		year: m.seasonYear,
		thumb: m.coverImage?.large,
		subtitle: parts.join(' · ') || 'Anime',
	};
}

function toItemData(m: Media, prefer: TitleLanguage): ItemData {
	return {
		type: 'anime',
		title: titleOf(m, prefer),
		source: 'anilist',
		sourceId: String(m.id),
		url: m.siteUrl,
		cover: m.coverImage?.large,
		rating: percentScoreToRating(m.averageScore),
		episodesTotal: m.episodes,
		format: m.format,
		seasonYear: m.seasonYear,
		description: stripHtml(m.description),
	};
}

export class AniListAdapter implements SourceAdapter {
	readonly id = 'anilist' as const;
	readonly label = 'AniList';
	readonly type = 'anime' as const;

	constructor(private readonly getSettings: () => SomedaySettings) {}

	private async query<T>(
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		const res = await postJson<GraphQLResponse<T>>(ENDPOINT, {
			query,
			variables,
		});
		if (res.errors?.length) {
			throw new HttpError(
				0,
				`AniList: ${res.errors[0]?.message ?? 'query error'}`,
			);
		}
		if (!res.data) throw new HttpError(0, 'AniList returned no data.');
		return res.data;
	}

	async search(query: string): Promise<SearchResult[]> {
		const settings = this.getSettings();
		const data = await this.query<{ Page?: { media?: Media[] } }>(
			searchQuery(settings.anilistIncludeAdult),
			{ q: query },
		);
		return (data.Page?.media ?? []).map((m) =>
			toSearchResult(m, settings.anilistTitleLanguage),
		);
	}

	async getDetails(sourceId: string): Promise<ItemData> {
		const data = await this.query<{ Media?: Media }>(DETAILS_QUERY, {
			id: Number(sourceId),
		});
		if (!data.Media) {
			throw new HttpError(0, `AniList has no anime with id ${sourceId}.`);
		}
		return toItemData(data.Media, this.getSettings().anilistTitleLanguage);
	}
}
