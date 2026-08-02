import { App, Modal, Notice, Setting, type TFile } from 'obsidian';
import type { ItemData } from '../types';
import { writeItem } from '../model/frontmatter';
import { displayTitle } from '../model/title';
import { clampRating, RATING_MAX, RATING_MIN } from '../model/rating';
import { statusesFor, type SomedaySettings } from '../settings';

export interface EditModalOptions {
	onSaved?: () => void;
}

/** Modal for the common per-item edits: status, rating, completed date, episodes. */
export class EditModal extends Modal {
	private status?: string;
	private ratingText: string;
	private completed: string;
	private episodesWatched?: number;
	private episodesInput?: HTMLInputElement;

	constructor(
		app: App,
		private readonly file: TFile,
		private readonly item: ItemData,
		private readonly settings: SomedaySettings,
		private readonly options: EditModalOptions = {},
	) {
		super(app);
		this.status = item.status;
		// Normalised so a hand-written fractional rating still selects an option.
		this.ratingText =
			item.rating !== undefined ? String(clampRating(item.rating)) : '';
		this.completed = item.completed ?? '';
		this.episodesWatched = item.episodesWatched;
	}

	onOpen(): void {
		const { contentEl } = this;
		const title = displayTitle(this.item, this.settings.titleLanguage);
		contentEl.addClass('someday-edit');
		contentEl.createEl('h2', { text: title });

		const body = contentEl.createDiv({ cls: 'someday-edit-body' });
		this.renderPoster(body, title);
		const form = body.createDiv({ cls: 'someday-edit-form' });

		new Setting(form).setName('Status').addDropdown((dd) => {
			dd.addOption('', '—');
			for (const status of statusesFor(this.settings, this.item.type)) {
				dd.addOption(status, status);
			}
			dd.setValue(this.status ?? '').onChange((value) => {
				this.status = value || undefined;
			});
		});

		new Setting(form).setName('Rating').addDropdown((dd) => {
			dd.addOption('', '—');
			for (let n = RATING_MIN; n <= RATING_MAX; n++) {
				dd.addOption(String(n), String(n));
			}
			dd.setValue(this.ratingText).onChange((v) => {
				this.ratingText = v;
			});
		});

		new Setting(form).setName('Completed').addText((text) => {
			text.inputEl.type = 'date';
			text.setValue(this.completed).onChange((v) => {
				this.completed = v;
			});
		});

		if (this.item.type === 'anime') {
			this.renderEpisodes(form);
		}

		new Setting(form)
			.addButton((btn) =>
				btn.setButtonText('Open note').onClick(() => this.openNote()),
			)
			.addButton((btn) =>
				btn
					.setButtonText('Save')
					.setCta()
					.onClick(() => void this.save()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderPoster(body: HTMLElement, title: string): void {
		const poster = body.createDiv({ cls: 'someday-edit-poster' });
		if (!this.item.cover) {
			poster.addClass('is-broken');
			return;
		}
		const img = poster.createEl('img', {
			attr: { src: this.item.cover, alt: title, loading: 'lazy' },
		});
		img.addEventListener('error', () => {
			img.remove();
			poster.addClass('is-broken');
		});
	}

	/** Close the modal and open the underlying note in a new tab. */
	private openNote(): void {
		this.close();
		void this.app.workspace.getLeaf(true).openFile(this.file);
	}

	private renderEpisodes(contentEl: HTMLElement): void {
		const total = this.item.episodesTotal;
		const setValue = (n: number) => {
			const bounded = total !== undefined ? Math.min(n, total) : n;
			this.episodesWatched = Math.max(0, bounded);
			if (this.episodesInput) {
				this.episodesInput.value = String(this.episodesWatched);
			}
		};

		const setting = new Setting(contentEl)
			.setName('Episodes watched')
			.setDesc(total !== undefined ? `of ${total}` : 'total unknown');

		setting.addButton((btn) =>
			btn.setButtonText('−').onClick(() => setValue((this.episodesWatched ?? 0) - 1)),
		);
		setting.addText((text) => {
			text.inputEl.type = 'number';
			text.inputEl.min = '0';
			if (total !== undefined) text.inputEl.max = String(total);
			text.setValue(
				this.episodesWatched !== undefined
					? String(this.episodesWatched)
					: '',
			);
			text.onChange((v) => {
				const n = Number(v);
				this.episodesWatched = v === '' || !Number.isFinite(n)
					? undefined
					: Math.max(0, n);
			});
			this.episodesInput = text.inputEl;
		});
		setting.addButton((btn) =>
			btn.setButtonText('＋').onClick(() => setValue((this.episodesWatched ?? 0) + 1)),
		);
		if (total !== undefined) {
			setting.addButton((btn) =>
				btn.setButtonText('Set to total').onClick(() => setValue(total)),
			);
		}
	}

	private ratingPatch(): number | undefined {
		const trimmed = this.ratingText.trim();
		if (trimmed === '') return undefined;
		const n = Number(trimmed);
		return Number.isFinite(n) ? clampRating(n) : undefined;
	}

	private async save(): Promise<void> {
		const patch: Partial<ItemData> = {
			status: this.status,
			rating: this.ratingPatch(),
			completed: this.completed,
		};
		if (this.item.type === 'anime') {
			patch.episodesWatched = this.episodesWatched;
		}
		try {
			await writeItem(this.app, this.file, patch);
			this.options.onSaved?.();
			this.close();
		} catch (err) {
			new Notice(
				`Could not save: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}
