// Plain data shapes shared across the plugin. These carry no behaviour and no
// Obsidian types, so the renderer and adapters can depend on them freely.

export type MediaType = 'anime' | 'game';
export type Source = 'anilist' | 'steam';

/**
 * The full description of one tracked item. `type` is derived from the folder a
 * note lives in (see model/media-type.ts) — it is never stored in frontmatter.
 */
export interface ItemData {
	type: MediaType;
	title: string; // primary/display title (English for anime)
	titleRomaji?: string; // Japanese romaji title, when distinct (anime)
	source: Source;
	sourceId: string;
	url?: string;
	cover?: string; // remote URL, used directly in <img>
	status?: string;
	rating?: number; // 1–10
	added?: string; // YYYY-MM-DD
	started?: string;
	completed?: string;
	// anime
	episodesTotal?: number;
	episodesWatched?: number;
	format?: string;
	seasonYear?: number;
	// game
	releaseDate?: string;
	platforms?: string[];
	// seeded into the note body on creation; not stored in frontmatter
	description?: string;
}

/** A lightweight hit shown in the import results list before details are fetched. */
export interface SearchResult {
	source: Source;
	sourceId: string;
	title: string;
	year?: number;
	thumb?: string;
	subtitle?: string; // e.g. "TV · 28 eps" or "Game · 2023"
}
