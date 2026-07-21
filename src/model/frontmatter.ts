import type { App, TFile } from 'obsidian';
import type { ItemData, MediaType, Source } from '../types';

// DTO mapping between an ItemData (camelCase, in-memory) and a note's YAML
// frontmatter (snake_case, on disk). This is plumbing: it moves values across
// the boundary and makes no business decisions.

type FieldKind = 'string' | 'number' | 'list';

interface Field {
	item: keyof ItemData;
	fm: string;
	kind: FieldKind;
}

// `type` (derived from folder) and `description` (lives in the body) are
// intentionally absent — they are never frontmatter.
const FIELDS: Field[] = [
	{ item: 'title', fm: 'title', kind: 'string' },
	{ item: 'titleRomaji', fm: 'title_romaji', kind: 'string' },
	{ item: 'status', fm: 'status', kind: 'string' },
	{ item: 'rating', fm: 'rating', kind: 'number' },
	{ item: 'source', fm: 'source', kind: 'string' },
	{ item: 'sourceId', fm: 'source_id', kind: 'string' },
	{ item: 'url', fm: 'url', kind: 'string' },
	{ item: 'cover', fm: 'cover', kind: 'string' },
	{ item: 'added', fm: 'added', kind: 'string' },
	{ item: 'started', fm: 'started', kind: 'string' },
	{ item: 'completed', fm: 'completed', kind: 'string' },
	{ item: 'episodesTotal', fm: 'episodes_total', kind: 'number' },
	{ item: 'episodesWatched', fm: 'episodes_watched', kind: 'number' },
	{ item: 'format', fm: 'format', kind: 'string' },
	{ item: 'seasonYear', fm: 'season_year', kind: 'number' },
	{ item: 'releaseDate', fm: 'release_date', kind: 'string' },
	{ item: 'platforms', fm: 'platforms', kind: 'list' },
];

/** Stringify only primitive scalars; objects/dates yield undefined (skipped). */
function scalarToString(value: unknown): string | undefined {
	if (typeof value === 'string') return value.length > 0 ? value : undefined;
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return undefined;
}

function coerce(value: unknown, kind: FieldKind): unknown {
	if (value === null || value === undefined) return undefined;
	switch (kind) {
		case 'number': {
			const n = typeof value === 'number' ? value : Number(value);
			return Number.isFinite(n) ? n : undefined;
		}
		case 'list': {
			const arr = Array.isArray(value) ? value : [value];
			const list = arr
				.map(scalarToString)
				.filter((s): s is string => s !== undefined);
			return list.length > 0 ? list : undefined;
		}
		case 'string':
			return scalarToString(value);
	}
}

/**
 * Read a note into an ItemData. `type` comes from the folder (caller derives
 * it); every other field comes from the cached frontmatter.
 */
export function readItem(app: App, file: TFile, type: MediaType): ItemData {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const item: ItemData = {
		type,
		title: (fm.title as string) ?? file.basename,
		source: (fm.source as Source) ?? 'steam',
		sourceId: fm.source_id !== undefined ? String(fm.source_id) : '',
	};
	for (const field of FIELDS) {
		if (field.item === 'title' || field.item === 'source') continue;
		const value = coerce(fm[field.fm], field.kind);
		if (value !== undefined) {
			// The FIELDS table guarantees value matches the field's type.
			(item as unknown as Record<string, unknown>)[field.item] = value;
		}
	}
	return item;
}

/**
 * Write a partial ItemData onto a note's frontmatter. A field set to undefined,
 * null, or '' is removed; any other value is written. `type`/`description` are
 * ignored (they are not frontmatter).
 */
export async function writeItem(
	app: App,
	file: TFile,
	patch: Partial<ItemData>,
): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		for (const field of FIELDS) {
			if (!(field.item in patch)) continue;
			const value = patch[field.item];
			if (value === undefined || value === null || value === '') {
				delete fm[field.fm];
			} else {
				fm[field.fm] = value;
			}
		}
	});
}
