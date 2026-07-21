import { BasesView, type QueryController } from 'obsidian';
import type SomedayLibPlugin from '../main';
import type { Source } from '../types';
import { typeForFile } from '../model/media-type';
import { renderGallery } from '../ui/gallery';
import { ImportModal } from '../ui/import-modal';

export const SOMEDAY_VIEW_TYPE = 'someday-cards';

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
		this.render();
	}

	onunload(): void {
		this.root?.remove();
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
