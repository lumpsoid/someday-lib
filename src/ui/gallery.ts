import type { App, TFile } from 'obsidian';
import type { ItemData } from '../types';
import type { SomedaySettings } from '../settings';
import { readItem } from '../model/frontmatter';
import { typeForFile } from '../model/media-type';
import { renderCards, type CardLayout } from './card-grid';
import { EditModal } from './edit-modal';

/** A layout choice as a user makes it: either pinned, or left to the items. */
export type CardLayoutSetting = CardLayout | 'auto';

export interface GalleryOptions {
	emptyText?: string;
	/** Cover shape, or `auto` (the default) to infer it from the items. */
	layout?: CardLayoutSetting;
	/** Invoked after an edit is saved (e.g. to re-render a non-reactive host). */
	onChanged?: () => void;
}

/** Narrow a stored/config value to a setting, falling back to `auto`. */
export function parseCardLayout(raw: unknown): CardLayoutSetting {
	return raw === 'portrait' || raw === 'landscape' ? raw : 'auto';
}

/**
 * Resolve `auto`: only an all-games gallery gets the landscape box, since Steam
 * is the source with landscape art. Anime — and any mix, where one shape has to
 * lose — stays portrait.
 */
function resolveLayout(
	setting: CardLayoutSetting,
	items: ItemData[],
): CardLayout {
	if (setting !== 'auto') return setting;
	const allGames =
		items.length > 0 && items.every((item) => item.type === 'game');
	return allGames ? 'landscape' : 'portrait';
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
		titleLanguage: settings.titleLanguage,
		layout: resolveLayout(options.layout ?? 'auto', items),
		onOpen: (item) => {
			const file = fileFor.get(item);
			if (!file) return;
			new EditModal(app, file, item, settings, {
				onSaved: options.onChanged,
			}).open();
		},
	});
}
