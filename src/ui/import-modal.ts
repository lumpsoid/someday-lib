import { App, Modal, Notice, Setting, type TFile } from 'obsidian';
import type { ItemData, SearchResult, Source } from '../types';
import type { SourceAdapter } from '../sources/adapter';
import { createNote, mergeNote } from '../model/note-writer';
import { findExistingNote } from '../model/duplicate';
import { displayTitle } from '../model/title';
import { DuplicateModal, type DuplicateChoice } from './duplicate-modal';
import { defaultStatus, type SomedaySettings } from '../settings';

export interface ImportModalOptions {
	/** Upstream to pre-select (e.g. an Anime base opens straight to AniList). */
	initialSource?: Source;
	/** Called once per note the import created or merged, e.g. to refresh a view. */
	onImported?: (file: TFile) => void;
}

/**
 * How the query field is interpreted. Upstream title search still misses
 * entries the storefront will not list — delisted, region-restricted or
 * unreleased — so the user can switch to resolving an id directly.
 */
type LookupMode = 'title' | 'id';

export class ImportModal extends Modal {
	private source: Source;
	private mode: LookupMode = 'title';
	private query = '';
	private results: SearchResult[] = [];
	/** Ids already listed — later pages may repeat hits from earlier ones. */
	private readonly listed = new Set<string>();
	private readonly selected = new Set<string>();
	private queryEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private rowsEl!: HTMLElement;
	private moreEl!: HTMLElement;
	private addButton!: HTMLButtonElement;
	private searching = false;
	/**
	 * The search the listed results came from. The source dropdown and the query
	 * field may have moved on since, but "Show more" has to keep paging this one.
	 */
	private activeSource?: Source;
	private activeQuery = '';
	private nextPage = 1;
	private hasMore = false;
	private loadingMore = false;
	private emptyText = 'No results. Enter a query and search.';
	/** Set when a duplicate dialog is answered with "apply to the rest". */
	private standingChoice?: DuplicateChoice;

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
		this.rowsEl = this.resultsEl.createDiv();
		// Kept outside the rows so loading a page can append to the list without
		// rebuilding it, which would throw away the scroll position.
		this.moreEl = this.resultsEl.createDiv({ cls: 'someday-import-more' });

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
			await this.runSearch(raw);
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

	/** A fresh title search: replaces the list and arms "Show more". */
	private async runSearch(query: string): Promise<void> {
		const source = this.source;
		this.activeSource = source;
		this.activeQuery = query;
		this.nextPage = 1;
		this.beginLookup(
			'No results. Try the ID lookup — search misses delisted and region-restricted titles.',
		);
		try {
			const page = await this.adapters[source].search(query, this.nextPage);
			this.nextPage += 1;
			this.hasMore = page.hasMore;
			this.addResults(page.results);
		} catch (err) {
			new Notice(`Lookup failed: ${errorMessage(err)}`);
		} finally {
			this.searching = false;
			this.renderResults();
		}
	}

	private async runLookup(
		fetch: () => Promise<SearchResult[]>,
		emptyText: string,
	): Promise<void> {
		// A by-id lookup resolves one entry, so it is never paged.
		this.activeSource = undefined;
		this.beginLookup(emptyText);
		try {
			this.addResults(await fetch());
		} catch (err) {
			new Notice(`Lookup failed: ${errorMessage(err)}`);
		} finally {
			this.searching = false;
			this.renderResults();
		}
	}

	/** Clear the list and show the pending state while a lookup runs. */
	private beginLookup(emptyText: string): void {
		this.searching = true;
		this.selected.clear();
		this.results = [];
		this.listed.clear();
		this.hasMore = false;
		this.emptyText = emptyText;
		this.rowsEl.empty();
		this.rowsEl.createDiv({ cls: 'someday-empty', text: 'Searching…' });
		this.moreEl.empty();
	}

	/** Append the hits that are not listed yet; returns just those. */
	private addResults(results: SearchResult[]): SearchResult[] {
		const fresh = results.filter((r) => !this.listed.has(r.sourceId));
		for (const result of fresh) this.listed.add(result.sourceId);
		this.results.push(...fresh);
		return fresh;
	}

	/** Load the next page of the current search onto the end of the list. */
	private async loadMore(): Promise<void> {
		if (this.loadingMore || !this.hasMore) return;
		const source = this.activeSource;
		if (source === undefined) return;
		this.loadingMore = true;
		this.renderMore();
		try {
			const page = await this.adapters[source].search(
				this.activeQuery,
				this.nextPage,
			);
			this.nextPage += 1;
			this.hasMore = page.hasMore;
			// addResults still guards against a repeat: every page walks a fresh
			// offset now, but a shifting result set upstream can still resend a hit.
			for (const result of this.addResults(page.results)) this.renderRow(result);
		} catch (err) {
			new Notice(`Loading more failed: ${errorMessage(err)}`);
		} finally {
			this.loadingMore = false;
			this.renderMore();
			this.updateAddButton();
		}
	}

	private renderResults(): void {
		this.rowsEl.empty();
		if (this.results.length === 0) {
			this.rowsEl.createDiv({
				cls: 'someday-empty',
				text: this.emptyText,
			});
		}
		for (const result of this.results) this.renderRow(result);
		this.renderMore();
		this.updateAddButton();
	}

	private renderRow(result: SearchResult): void {
		const row = this.rowsEl.createDiv({ cls: 'someday-result' });
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

	private renderMore(): void {
		this.moreEl.empty();
		if (!this.hasMore || this.results.length === 0) return;
		const btn = this.moreEl.createEl('button', {
			text: this.loadingMore ? 'Loading…' : 'Show more',
			cls: 'someday-more',
		});
		btn.disabled = this.loadingMore;
		btn.addEventListener('click', () => void this.loadMore());
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
		this.standingChoice = undefined;
		const touched: TFile[] = [];
		const outcome: ImportOutcome = {
			created: 0,
			merged: 0,
			skipped: 0,
			failed: 0,
		};
		const progress = new Notice(`Adding 0/${picks.length}…`, 0);
		try {
			for (const [index, pick] of picks.entries()) {
				progress.setMessage(`Adding ${index + 1}/${picks.length}…`);
				try {
					const item = await adapter.getDetails(pick.sourceId);
					item.status = defaultStatus(this.settings, adapter.type);

					const existing = findExistingNote(
						this.app,
						item,
						this.settings,
					);
					const choice = existing
						? await this.resolveDuplicate(
								item,
								existing,
								picks.length - index - 1,
							)
						: 'create';

					if (existing && choice === 'merge') {
						await mergeNote(this.app, existing, item);
						outcome.merged += 1;
						touched.push(existing);
						this.options.onImported?.(existing);
					} else if (choice === 'skip') {
						outcome.skipped += 1;
					} else {
						const file = await createNote(
							this.app,
							item,
							this.settings,
						);
						outcome.created += 1;
						touched.push(file);
						this.options.onImported?.(file);
					}
				} catch (err) {
					outcome.failed += 1;
					new Notice(`Failed: ${pick.title} — ${errorMessage(err)}`);
				}
			}
		} finally {
			progress.hide();
		}

		this.close();
		this.reportImport(touched, outcome);
	}

	/**
	 * What to do about `item` already being in the vault — the user's answer,
	 * unless an earlier answer in this run said to apply itself to the rest.
	 */
	private async resolveDuplicate(
		item: ItemData,
		existing: TFile,
		remaining: number,
	): Promise<DuplicateChoice> {
		if (this.standingChoice) return this.standingChoice;
		const decision = await DuplicateModal.ask(this.app, {
			title: displayTitle(item, this.settings.titleLanguage),
			existing,
			remaining,
		});
		if (decision.applyToRest) this.standingChoice = decision.choice;
		return decision.choice;
	}

	/**
	 * Summarise the import in a Notice. Nothing is opened automatically —
	 * each touched note gets a link that opens it in a new tab on click.
	 */
	private reportImport(touched: TFile[], outcome: ImportOutcome): void {
		const parts = [`Added ${outcome.created}`];
		if (outcome.merged > 0) parts.push(`merged ${outcome.merged}`);
		if (outcome.skipped > 0) parts.push(`skipped ${outcome.skipped}`);
		if (outcome.failed > 0) parts.push(`${outcome.failed} failed`);
		const summary = `${parts.join(', ')}.`;
		if (touched.length === 0) {
			new Notice(summary);
			return;
		}

		const frag = createFragment();
		frag.createDiv({ text: summary });
		const list = frag.createDiv({ cls: 'someday-notice-links' });
		const shown = touched.slice(0, NOTICE_LINK_LIMIT);
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
		const rest = touched.length - shown.length;
		if (rest > 0) {
			list.createDiv({
				cls: 'someday-notice-more',
				text: `…and ${rest} more.`,
			});
		}
		new Notice(frag, NOTICE_DURATION_MS);
	}
}

/** Tally of what one import run did, for the closing Notice. */
interface ImportOutcome {
	created: number;
	merged: number;
	skipped: number;
	failed: number;
}

/** Keep the Notice from covering the screen on a big import. */
const NOTICE_LINK_LIMIT = 8;
/** Long enough to actually click a link. */
const NOTICE_DURATION_MS = 15000;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
