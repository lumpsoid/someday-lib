import { TFile, type App } from 'obsidian';
import type { ItemData } from '../types';
import type { SomedaySettings } from '../settings';
import { folderForType, typeForPath } from './media-type';
import { safeFileName } from './filename';

// When is an import "the same item as one already in the vault"? This module is
// the single home for that question; the import flow only acts on the answer.

/**
 * The note already tracking `item`, or null when it is new.
 *
 * Identity is the (source, source_id) pair: it survives a rename, and it tells
 * two same-named entries apart. The target filename is a fallback, so a note
 * written by hand — or before ids were stored — is still recognised.
 */
export function findExistingNote(
	app: App,
	item: ItemData,
	settings: SomedaySettings,
): TFile | null {
	if (item.sourceId) {
		for (const file of app.vault.getMarkdownFiles()) {
			if (typeForPath(file.path, settings) !== item.type) continue;
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			const id = fm.source_id !== undefined ? String(fm.source_id) : '';
			if (fm.source === item.source && id === item.sourceId) return file;
		}
	}

	const folder = folderForType(settings, item.type);
	const dir = folder ? `${folder}/` : '';
	const byName = app.vault.getAbstractFileByPath(
		`${dir}${safeFileName(item.title)}.md`,
	);
	return byName instanceof TFile ? byName : null;
}
