import { App, PluginSettingTab, Setting } from 'obsidian';
import type SomedayLibPlugin from './main';
import type { MediaType } from './types';

/** Which stored title variant to display on cards. */
export type TitleLanguage = 'romaji' | 'english';

export interface SomedaySettings {
	/** Vault-relative folder that holds game notes. Its contents are typed `game`. */
	gamesFolder: string;
	/** Vault-relative folder that holds anime notes. Its contents are typed `anime`. */
	animeFolder: string;
	/** Steam country code, affects pricing/availability (e.g. `us`). */
	steamCc: string;
	/** Steam store language (e.g. `english`). */
	steamLang: string;
	/** Whether AniList search may return adult titles. */
	anilistIncludeAdult: boolean;
	/** Which stored title to display on cards (falls back to the other if missing). */
	titleLanguage: TitleLanguage;
	/** Ordered status vocabulary for anime; the first entry is the import default. */
	animeStatuses: string[];
	/** Ordered status vocabulary for games; the first entry is the import default. */
	gameStatuses: string[];
}

export const DEFAULT_SETTINGS: SomedaySettings = {
	gamesFolder: 'Games',
	animeFolder: 'Anime',
	steamCc: 'us',
	steamLang: 'english',
	anilistIncludeAdult: false,
	titleLanguage: 'english',
	animeStatuses: ['planning', 'watching', 'completed', 'paused', 'dropped'],
	gameStatuses: ['wishlist', 'backlog', 'playing', 'completed', 'dropped'],
};

/** The status vocabulary for a media type — the single home for this lookup. */
export function statusesFor(
	settings: SomedaySettings,
	type: MediaType,
): string[] {
	return type === 'anime' ? settings.animeStatuses : settings.gameStatuses;
}

/** The status a freshly imported item gets: the first entry of its vocabulary. */
export function defaultStatus(
	settings: SomedaySettings,
	type: MediaType,
): string | undefined {
	return statusesFor(settings, type)[0];
}

const parseList = (raw: string): string[] =>
	raw
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

export class SomedaySettingTab extends PluginSettingTab {
	plugin: SomedayLibPlugin;

	constructor(app: App, plugin: SomedayLibPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Folders').setHeading();

		new Setting(containerEl)
			.setName('Games folder')
			.setDesc('Notes in this folder are treated as games.')
			.addText((text) =>
				text
					.setPlaceholder('Games')
					.setValue(this.plugin.settings.gamesFolder)
					.onChange(async (value) => {
						this.plugin.settings.gamesFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Anime folder')
			.setDesc('Notes in this folder are treated as anime.')
			.addText((text) =>
				text
					.setPlaceholder('Anime')
					.setValue(this.plugin.settings.animeFolder)
					.onChange(async (value) => {
						this.plugin.settings.animeFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Steam').setHeading();

		new Setting(containerEl)
			.setName('Country code')
			.setDesc('Affects Steam pricing and availability, e.g. us, gb, de.')
			.addText((text) =>
				text
					.setPlaceholder('us')
					.setValue(this.plugin.settings.steamCc)
					.onChange(async (value) => {
						this.plugin.settings.steamCc = value.trim() || 'us';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Language')
			.setDesc('Steam store language, e.g. english, german.')
			.addText((text) =>
				text
					.setPlaceholder('english')
					.setValue(this.plugin.settings.steamLang)
					.onChange(async (value) => {
						this.plugin.settings.steamLang =
							value.trim() || 'english';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Display').setHeading();

		new Setting(containerEl)
			.setName('Title language')
			.setDesc(
				'Which title to show on cards. Falls back to the other if missing (e.g. games have no romaji).',
			)
			.addDropdown((dd) =>
				dd
					.addOption('english', 'English')
					.addOption('romaji', 'Japanese (romaji)')
					.setValue(this.plugin.settings.titleLanguage)
					.onChange(async (value) => {
						this.plugin.settings.titleLanguage =
							value as TitleLanguage;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('AniList').setHeading();

		new Setting(containerEl)
			.setName('Include adult titles')
			.setDesc('Show adult (18+) results in AniList search.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.anilistIncludeAdult)
					.onChange(async (value) => {
						this.plugin.settings.anilistIncludeAdult = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Status vocabulary').setHeading();

		new Setting(containerEl)
			.setName('Anime statuses')
			.setDesc('Comma-separated. The first is the default for new imports.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.animeStatuses.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.animeStatuses = parseList(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Game statuses')
			.setDesc('Comma-separated. The first is the default for new imports.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.gameStatuses.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.gameStatuses = parseList(value);
						await this.plugin.saveSettings();
					}),
			);
	}
}
