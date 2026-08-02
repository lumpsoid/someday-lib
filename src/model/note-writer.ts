import type { App, TFile } from 'obsidian';
import type { ItemData } from '../types';
import type { SomedaySettings } from '../settings';
import { folderForType } from './media-type';
import { safeFileName, uniquePath } from './filename';
import { sourceOwnedPatch, writeItem } from './frontmatter';

/** Local date as YYYY-MM-DD, used to stamp when an item was added. */
function todayIso(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	if (app.vault.getAbstractFileByPath(folder)) return;
	// Create each ancestor segment so nested folders come into being.
	const parts = folder.split('/');
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

/**
 * Create a note for `item` in the folder its type dictates, with a safe unique
 * filename, the free-text description as the body, and the rest as frontmatter.
 */
export async function createNote(
	app: App,
	item: ItemData,
	settings: SomedaySettings,
): Promise<TFile> {
	const folder = folderForType(settings, item.type);
	await ensureFolder(app, folder);

	const path = uniquePath(app.vault, folder, safeFileName(item.title));
	const body = item.description ? `${item.description.trim()}\n` : '';
	const file = await app.vault.create(path, body);

	await writeItem(app, file, { ...item, added: item.added ?? todayIso() });
	return file;
}

/**
 * Refresh an existing note from a fresh fetch of the same item: source-owned
 * frontmatter is overwritten, everything the reader put there — status, rating,
 * dates, progress — is left alone. The body is never rewritten either; the
 * description only ever seeds a new note, and by now it may hold the user's own
 * notes.
 */
export async function mergeNote(
	app: App,
	file: TFile,
	item: ItemData,
): Promise<void> {
	await writeItem(app, file, sourceOwnedPatch(item));
}
