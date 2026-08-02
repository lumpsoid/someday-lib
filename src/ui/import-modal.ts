import { App, Modal, Notice, Setting, type TFile } from 'obsidian';
import type { SearchResult, Source } from '../types';
import type { SourceAdapter } from '../sources/adapter';
import { createNote } from '../model/note-writer';
import { defaultStatus, type SomedaySettings } from '../settings';

export interface ImportModalOptions {
	/** Upstream to pre-select (e.g. an Anime base opens straight to AniList). */
	initialSource?: Source;
	/** Called once per created note, e.g. to refresh a view. */
	onCreated?: (file: TFile) => void;
}

export class ImportModal extends Modal {
	private source: Source;
	private results: SearchResult[] = [];
	private readonly selected = new Set<string>();
	private resultsEl!: HTMLElement;
	private addButton!: HTMLButtonElement;
	private searching = false;

	constructor(
		app: App,
		private readonly adapters: Record<Source, SourceAdapter>,
		private readonly settings: SomedaySettings,
		private readonly options: ImportModalOptions = {},
	) {
		super(app);
		this.source = options.initialSource ?? 'steam';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('someday-import');
		contentEl.createEl('h2', { text: 'Add game or anime' });

		new Setting(contentEl).setName('Source').addDropdown((dd) => {
			for (const id of Object.keys(this.adapters) as Source[]) {
				dd.addOption(id, this.adapters[id].label);
			}
			dd.setValue(this.source).onChange((value) => {
				this.source = value as Source;
			});
		});

		let queryValue = '';
		new Setting(contentEl)
			.setName('Search')
			.addText((text) => {
				text.setPlaceholder('Title…').onChange((v) => {
					queryValue = v;
				});
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') {
						evt.preventDefault();
						void this.doSearch(queryValue);
					}
				});
			})
			.addButton((btn) =>
				btn
					.setButtonText('Search')
					.setCta()
					.onClick(() => void this.doSearch(queryValue)),
			);

		this.resultsEl = contentEl.createDiv({ cls: 'someday-import-results' });

		const footer = contentEl.createDiv({ cls: 'someday-import-footer' });
		this.addButton = footer.createEl('button', {
			text: 'Add selected',
			cls: 'mod-cta',
		});
		this.addButton.disabled = true;
		this.addButton.addEventListener('click', () => void this.doAdd());

		this.renderResults();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async doSearch(query: string): Promise<void> {
		const q = query.trim();
		if (!q || this.searching) return;
		this.searching = true;
		this.selected.clear();
		this.results = [];
		this.resultsEl.empty();
		this.resultsEl.createDiv({ cls: 'someday-empty', text: 'Searching…' });
		try {
			this.results = await this.adapters[this.source].search(q);
		} catch (err) {
			this.results = [];
			new Notice(`Search failed: ${errorMessage(err)}`);
		} finally {
			this.searching = false;
			this.renderResults();
		}
	}

	private renderResults(): void {
		this.resultsEl.empty();
		if (this.results.length === 0) {
			this.resultsEl.createDiv({
				cls: 'someday-empty',
				text: 'No results. Enter a query and search.',
			});
		}
		for (const result of this.results) {
			const row = this.resultsEl.createDiv({ cls: 'someday-result' });
			const checkbox = row.createEl('input', {
				type: 'checkbox',
				cls: 'someday-result-check',
			});
			checkbox.checked = this.selected.has(result.sourceId);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.selected.add(result.sourceId);
				else this.selected.delete(result.sourceId);
				this.updateAddButton();
			});

			if (result.thumb) {
				row.createEl('img', {
					cls: 'someday-result-thumb',
					attr: { src: result.thumb, alt: result.title, loading: 'lazy' },
				});
			}

			const meta = row.createDiv({ cls: 'someday-result-meta' });
			meta.createDiv({ cls: 'someday-result-title', text: result.title });
			const subtitle = [result.subtitle, result.year]
				.filter((v) => v !== undefined && v !== '')
				.join(' · ');
			if (subtitle) {
				meta.createDiv({ cls: 'someday-result-sub', text: subtitle });
			}

			row.addEventListener('click', (evt) => {
				if (evt.target === checkbox) return;
				checkbox.checked = !checkbox.checked;
				checkbox.dispatchEvent(new Event('change'));
			});
		}
		this.updateAddButton();
	}

	private updateAddButton(): void {
		const count = this.selected.size;
		this.addButton.disabled = count === 0 || this.searching;
		this.addButton.setText(
			count > 0 ? `Add selected (${count})` : 'Add selected',
		);
	}

	private async doAdd(): Promise<void> {
		const adapter = this.adapters[this.source];
		const picks = this.results.filter((r) => this.selected.has(r.sourceId));
		if (picks.length === 0) return;

		this.addButton.disabled = true;
		const created: TFile[] = [];
		let failures = 0;
		const progress = new Notice(`Adding 0/${picks.length}…`, 0);
		try {
			for (const [index, pick] of picks.entries()) {
				progress.setMessage(`Adding ${index + 1}/${picks.length}…`);
				try {
					const item = await adapter.getDetails(pick.sourceId);
					item.status = defaultStatus(this.settings, adapter.type);
					const file = await createNote(
						this.app,
						item,
						this.settings,
					);
					created.push(file);
					this.options.onCreated?.(file);
				} catch (err) {
					failures += 1;
					new Notice(`Failed: ${pick.title} — ${errorMessage(err)}`);
				}
			}
		} finally {
			progress.hide();
		}

		this.close();
		this.reportCreated(created, failures);
	}

	/**
	 * Summarise the import in a Notice. Nothing is opened automatically —
	 * each created note gets a link that opens it in a new tab on click.
	 */
	private reportCreated(created: TFile[], failures: number): void {
		const summary =
			`Added ${created.length} note${created.length === 1 ? '' : 's'}` +
			(failures > 0 ? `, ${failures} failed.` : '.');
		if (created.length === 0) {
			new Notice(summary);
			return;
		}

		const frag = createFragment();
		frag.createDiv({ text: summary });
		const list = frag.createDiv({ cls: 'someday-notice-links' });
		const shown = created.slice(0, NOTICE_LINK_LIMIT);
		for (const file of shown) {
			const link = list.createEl('a', {
				text: file.basename,
				cls: 'someday-notice-link',
				href: '#',
			});
			link.addEventListener('click', (evt) => {
				evt.preventDefault();
				void this.app.workspace.getLeaf(true).openFile(file);
			});
		}
		const rest = created.length - shown.length;
		if (rest > 0) {
			list.createDiv({
				cls: 'someday-notice-more',
				text: `…and ${rest} more.`,
			});
		}
		new Notice(frag, NOTICE_DURATION_MS);
	}
}

/** Keep the Notice from covering the screen on a big import. */
const NOTICE_LINK_LIMIT = 8;
/** Long enough to actually click a link. */
const NOTICE_DURATION_MS = 15000;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
