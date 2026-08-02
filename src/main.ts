import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SomedaySettingTab,
	type SomedaySettings,
} from './settings';
import type { Source } from './types';
import { createAdapters, type SourceAdapter } from './sources/adapter';
import {
	cardLayoutOption,
	SomedayCardsView,
	SOMEDAY_VIEW_TYPE,
} from './view/bases-view';
import { registerGalleryCodeblock } from './view/codeblock';
import { ImportModal } from './ui/import-modal';

export default class SomedayLibPlugin extends Plugin {
	settings!: SomedaySettings;
	adapters!: Record<Source, SourceAdapter>;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.adapters = createAdapters(() => this.settings);

		// Returns false when Bases is disabled in the vault; the rest of the
		// plugin (import, code-block gallery) still works without the view.
		this.registerBasesView(SOMEDAY_VIEW_TYPE, {
			name: 'Someday cards',
			icon: 'layout-grid',
			factory: (controller, containerEl) =>
				new SomedayCardsView(controller, containerEl, this),
			options: () => [cardLayoutOption()],
		});

		registerGalleryCodeblock(this);

		this.addCommand({
			id: 'add-game-or-anime',
			name: 'Add game or anime',
			callback: () => this.openImport(),
		});
		this.addRibbonIcon('layout-grid', 'Add game or anime', () =>
			this.openImport(),
		);

		this.addSettingTab(new SomedaySettingTab(this.app, this));
	}

	openImport(): void {
		new ImportModal(this.app, this.adapters, this.settings).open();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SomedaySettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
