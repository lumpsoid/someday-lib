import {
	BasesView,
	type BasesDropdownOption,
	type QueryController,
} from 'obsidian';
import type SomedayLibPlugin from '../main';
import type { Source } from '../types';
import { typeForFile } from '../model/media-type';
import { parseCardLayout, renderGallery } from '../ui/gallery';
import { ImportModal } from '../ui/import-modal';

export const SOMEDAY_VIEW_TYPE = 'someday-cards';

/** Config key holding this view's card layout, stored in the `.base` file. */
const CARD_LAYOUT_KEY = 'cardLayout';

/**
 * The layout picker Bases shows in this view's config menu. `auto` fits the box
 * to the source (landscape for a games base, portrait for anime); the explicit
 * values are there for the bases that guess wrong.
 */
export function cardLayoutOption(): BasesDropdownOption {
	return {
		type: 'dropdown',
		key: CARD_LAYOUT_KEY,
		displayName: 'Card layout',
		default: 'auto',
		options: {
			auto: 'Auto',
			portrait: 'Portrait',
			landscape: 'Landscape',
		},
	};
}

/**
 * The custom Bases view. Bases hands us a query result; we map each entry's file
 * to an ItemData and render the shared card grid. Obsidian re-runs the query and
 * calls onDataUpdated whenever the vault or config changes, so we never cache.
 */
export class SomedayCardsView extends BasesView {
	type = SOMEDAY_VIEW_TYPE;

	private root?: HTMLElement;
	private cardsEl?: HTMLElement;

	constructor(
		controller: QueryController,
		private readonly containerEl: HTMLElement,
		private readonly plugin: SomedayLibPlugin,
	) {
		super(controller);
	}

	onload(): void {
		this.root = this.containerEl.createDiv({ cls: 'someday-view' });
		const toolbar = this.root.createDiv({ cls: 'someday-view-toolbar' });
		const add = toolbar.createEl('button', {
			text: 'Add',
			cls: 'mod-cta',
		});
		add.addEventListener('click', () => this.openImport());
		this.cardsEl = this.root.createDiv({ cls: 'someday-view-cards' });
		// Build the shell only. Bases assigns `config` and `data` *after* it
		// loads the view, so there is nothing to draw yet — and reading
		// `this.config` this early throws, which aborts the very query setup
		// that would have fed us. onDataUpdated does every paint.
	}

	onunload(): void {
		this.root?.remove();
		this.root = undefined;
		this.cardsEl = undefined;
	}

	onDataUpdated(): void {
		this.render();
	}

	private entries() {
		return this.data ? this.data.data : [];
	}

	private render(): void {
		if (!this.cardsEl) return;
		const files = this.entries().map((entry) => entry.file);
		renderGallery(
			this.plugin.app,
			this.cardsEl,
			files,
			this.plugin.settings,
			{
				emptyText:
					'No notes match this base yet. Use Add to import one.',
				layout: parseCardLayout(this.config.get(CARD_LAYOUT_KEY)),
			},
		);
	}

	/** The upstream matching this base's folder, inferred from its entries. */
	private baseSource(): Source | undefined {
		for (const entry of this.entries()) {
			const type = typeForFile(entry.file, this.plugin.settings);
			if (type) return type === 'game' ? 'steam' : 'anilist';
		}
		return undefined;
	}

	private openImport(): void {
		new ImportModal(
			this.plugin.app,
			this.plugin.adapters,
			this.plugin.settings,
			{ initialSource: this.baseSource() },
		).open();
	}
}
