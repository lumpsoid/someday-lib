import type { App, TFile } from 'obsidian';
import type { ItemData, MediaType, Source } from '../types';

// DTO mapping between an ItemData (camelCase, in-memory) and a note's YAML
// frontmatter (snake_case, on disk). This is plumbing: it moves values across
// the boundary and makes no business decisions.

type FieldKind = 'string' | 'number' | 'list';

/**
 * Who a field belongs to. `source` fields are facts the upstream describes and
 * a re-import may refresh; `user` fields are the reader's own record (progress,
 * verdict, dates) and no import ever touches them.
 */
type Owner = 'source' | 'user';

interface Field {
	item: keyof ItemData;
	fm: string;
	kind: FieldKind;
	owner: Owner;
}

// `type` (derived from folder) and `description` (lives in the body) are
// intentionally absent — they are never frontmatter.
const FIELDS: Field[] = [
	{ item: 'title', fm: 'title', kind: 'string', owner: 'source' },
	{ item: 'titleRomaji', fm: 'title_romaji', kind: 'string', owner: 'source' },
	{ item: 'status', fm: 'status', kind: 'string', owner: 'user' },
	{ item: 'rating', fm: 'rating', kind: 'number', owner: 'user' },
	{ item: 'source', fm: 'source', kind: 'string', owner: 'source' },
	{ item: 'sourceId', fm: 'source_id', kind: 'string', owner: 'source' },
	{ item: 'url', fm: 'url', kind: 'string', owner: 'source' },
	{ item: 'cover', fm: 'cover', kind: 'string', owner: 'source' },
	{ item: 'added', fm: 'added', kind: 'string', owner: 'user' },
	{ item: 'started', fm: 'started', kind: 'string', owner: 'user' },
	{ item: 'completed', fm: 'completed', kind: 'string', owner: 'user' },
	{ item: 'episodesTotal', fm: 'episodes_total', kind: 'number', owner: 'source' },
	{ item: 'episodesWatched', fm: 'episodes_watched', kind: 'number', owner: 'user' },
	{ item: 'format', fm: 'format', kind: 'string', owner: 'source' },
	{ item: 'seasonYear', fm: 'season_year', kind: 'number', owner: 'source' },
	{ item: 'releaseDate', fm: 'release_date', kind: 'string', owner: 'source' },
	{ item: 'platforms', fm: 'platforms', kind: 'list', owner: 'source' },
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
 * The part of a freshly fetched `item` a re-import may write onto a note that
 * already exists: the source-owned facts, minus any the source did not return
 * this time (a missing cover means "not fetched", never "drop the stored one").
 * User-owned fields are absent from the patch, so merging never disturbs them.
 */
export function sourceOwnedPatch(item: ItemData): Partial<ItemData> {
	const patch: Partial<ItemData> = {};
	for (const field of FIELDS) {
		if (field.owner !== 'source') continue;
		const value = item[field.item];
		if (value === undefined || value === null || value === '') continue;
		(patch as Record<string, unknown>)[field.item] = value;
	}
	return patch;
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
