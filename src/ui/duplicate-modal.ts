import { App, Modal, Setting, type TFile } from 'obsidian';

/** What to do with an import whose item is already in the vault. */
export type DuplicateChoice = 'merge' | 'create' | 'skip';

export interface DuplicateDecision {
	choice: DuplicateChoice;
	/** Apply this same choice to every remaining duplicate without asking. */
	applyToRest: boolean;
}

export interface DuplicateModalOptions {
	/** Item being imported, by its display title. */
	title: string;
	/** The note already tracking it. */
	existing: TFile;
	/** How many picks are still queued behind this one. */
	remaining: number;
}

/**
 * Asks what to do about an item the vault already has. Dismissing the dialog
 * (Escape, clicking out) is the safe answer: skip, and keep asking.
 */
export class DuplicateModal extends Modal {
	private decision?: DuplicateDecision;
	private applyToRest = false;
	private resolve!: (decision: DuplicateDecision) => void;

	private constructor(
		app: App,
		private readonly options: DuplicateModalOptions,
	) {
		super(app);
	}

	/** Open the dialog and resolve with the user's answer. */
	static ask(
		app: App,
		options: DuplicateModalOptions,
	): Promise<DuplicateDecision> {
		const modal = new DuplicateModal(app, options);
		return new Promise<DuplicateDecision>((resolve) => {
			modal.resolve = resolve;
			modal.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		const { title, existing, remaining } = this.options;
		contentEl.addClass('someday-duplicate');
		contentEl.createEl('h2', { text: 'Note already exists' });
		contentEl.createEl('p', {
			cls: 'someday-duplicate-desc',
			text: `“${title}” is already tracked in ${existing.path}. Choose what to do.`,
		});

		new Setting(contentEl)
			.setName('Merge')
			.setDesc(
				'Refresh the imported details on the existing note. Your status, rating, dates and progress stay as they are.',
			)
			.addButton((btn) => {
				btn.setButtonText('Merge')
					.setCta()
					.onClick(() => this.decide('merge'));
				// Enter takes the non-destructive default.
				window.setTimeout(() => btn.buttonEl.focus());
			});

		new Setting(contentEl)
			.setName('Create a new note')
			.setDesc('Keep both notes; the new one gets a numbered filename.')
			.addButton((btn) =>
				btn.setButtonText('Create').onClick(() => this.decide('create')),
			);

		new Setting(contentEl)
			.setName('Do nothing')
			.setDesc('Leave the existing note untouched and skip this import.')
			.addButton((btn) =>
				btn.setButtonText('Skip').onClick(() => this.decide('skip')),
			);

		if (remaining > 0) {
			new Setting(contentEl)
				.setName(
					`Apply to the remaining ${remaining} item${remaining === 1 ? '' : 's'}`,
				)
				.setDesc('Do not ask again for this import.')
				.addToggle((toggle) =>
					toggle.setValue(this.applyToRest).onChange((value) => {
						this.applyToRest = value;
					}),
				);
		}
	}

	onClose(): void {
		this.contentEl.empty();
		// A dismissed dialog is a decision too — the cautious one.
		this.resolve(
			this.decision ?? { choice: 'skip', applyToRest: false },
		);
	}

	private decide(choice: DuplicateChoice): void {
		this.decision = { choice, applyToRest: this.applyToRest };
		this.close();
	}
}
