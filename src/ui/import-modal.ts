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

/**
 * How the query field is interpreted. Upstream title search misses delisted and
 * region-restricted entries (Steam's storesearch never returns "Thief" 2014 or
 * Lost Ark), so the user can switch to resolving an id directly.
 */
type LookupMode = 'title' | 'id';

export class ImportModal extends Modal {
	private source: Source;
	private mode: LookupMode = 'title';
	private query = '';
	private results: SearchResult[] = [];
	private readonly selected = new Set<string>();
	private queryEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private addButton!: HTMLButtonElement;
	private searching = false;
	private emptyText = 'No results. Enter a query and search.';

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
				// The id field is labelled per source ("Steam app ID"/"AniList ID").
				this.renderQuery();
			});
		});

		this.renderModeToggle(contentEl);
		this.queryEl = contentEl.createDiv();
		this.renderQuery();

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

	/** Segmented control switching the query field between title and id. */
	private renderModeToggle(parent: HTMLElement): void {
		const setting = new Setting(parent).setName('Look up');
		const group = setting.controlEl.createDiv({ cls: 'someday-segmented' });
		const modes: Array<[LookupMode, string]> = [
			['title', 'By title'],
			['id', 'By ID'],
		];
		const buttons: Array<{ mode: LookupMode; btn: HTMLButtonElement }> = [];
		const sync = (): void => {
			for (const { mode, btn } of buttons) {
				const active = mode === this.mode;
				btn.toggleClass('is-active', active);
				btn.setAttr('aria-pressed', String(active));
			}
		};
		for (const [mode, label] of modes) {
			const btn = group.createEl('button', { text: label, type: 'button' });
			btn.addEventListener('click', () => {
				if (this.mode === mode) return;
				this.mode = mode;
				sync();
				this.renderQuery(true);
			});
			buttons.push({ mode, btn });
		}
		sync();
	}

	/** Rebuilt whenever the mode or the source changes — both retitle the field. */
	private renderQuery(focus = false): void {
		this.queryEl.empty();
		const adapter = this.adapters[this.source];
		const byId = this.mode === 'id';
		const setting = new Setting(this.queryEl).setName(
			byId ? adapter.idLabel : 'Search',
		);
		if (byId) setting.setDesc(adapter.idHint);
		setting
			.addText((text) => {
				text
					.setPlaceholder(byId ? adapter.idPlaceholder : 'Title…')
					.setValue(this.query)
					.onChange((v) => {
						this.query = v;
					});
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') {
						evt.preventDefault();
						void this.doSubmit();
					}
				});
				if (focus) text.inputEl.focus();
			})
			.addButton((btn) =>
				btn
					.setButtonText(byId ? 'Fetch' : 'Search')
					.setCta()
					.onClick(() => void this.doSubmit()),
			);
	}

	private async doSubmit(): Promise<void> {
		const raw = this.query.trim();
		if (!raw || this.searching) return;
		const adapter = this.adapters[this.source];

		if (this.mode === 'title') {
			await this.runLookup(
				() => adapter.search(raw),
				'No results. Try the ID lookup — search misses delisted and region-restricted titles.',
			);
			return;
		}

		const id = adapter.parseId(raw);
		if (id === undefined) {
			new Notice(`Not a valid ${adapter.idLabel}. ${adapter.idHint}`);
			return;
		}
		await this.runLookup(
			() => adapter.lookupById(id),
			`Nothing found for ${adapter.idLabel} ${id}.`,
		);
	}

	private async runLookup(
		fetch: () => Promise<SearchResult[]>,
		emptyText: string,
	): Promise<void> {
		this.searching = true;
		this.selected.clear();
		this.results = [];
		this.emptyText = emptyText;
		this.resultsEl.empty();
		this.resultsEl.createDiv({ cls: 'someday-empty', text: 'Searching…' });
		try {
			this.results = await fetch();
		} catch (err) {
			this.results = [];
			new Notice(`Lookup failed: ${errorMessage(err)}`);
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
				text: this.emptyText,
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
				// Sources ship different shapes (Steam landscape headers, AniList
				// portrait covers); the class picks the box that fits uncropped.
				row.createEl('img', {
					cls: `someday-result-thumb someday-thumb-${result.source}`,
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
