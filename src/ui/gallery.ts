import type { App, TFile } from 'obsidian';
import type { ItemData } from '../types';
import type { SomedaySettings } from '../settings';
import { readItem } from '../model/frontmatter';
import { typeForFile } from '../model/media-type';
import { renderCards } from './card-grid';
import { EditModal } from './edit-modal';

export interface GalleryOptions {
	emptyText?: string;
	/** Invoked after an edit is saved (e.g. to re-render a non-reactive host). */
	onChanged?: () => void;
}

/**
 * Turn a set of note files into a card gallery: derive each note's ItemData,
 * render the grid, and open the edit modal on click. Files whose folder has no
 * media type are skipped. Shared by the Bases view and the code-block embed.
 */
export function renderGallery(
	app: App,
	container: HTMLElement,
	files: TFile[],
	settings: SomedaySettings,
	options: GalleryOptions = {},
): void {
	const fileFor = new WeakMap<ItemData, TFile>();
	const items: ItemData[] = [];
	for (const file of files) {
		const type = typeForFile(file, settings);
		if (!type) continue;
		const item = readItem(app, file, type);
		fileFor.set(item, file);
		items.push(item);
	}

	renderCards(container, items, {
		emptyText: options.emptyText,
		onOpen: (item) => {
			const file = fileFor.get(item);
			if (!file) return;
			new EditModal(app, file, item, settings, {
				onSaved: options.onChanged,
			}).open();
		},
	});
}
