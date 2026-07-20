import type { TFile } from 'obsidian';
import type { MediaType } from '../types';
import type { SomedaySettings } from '../settings';

// The folder a note lives in *is* its media type. This module is the single
// home for that derivation rule; nothing else should branch on folder paths.

const trimSlashes = (folder: string): string =>
	folder.replace(/^\/+|\/+$/g, '');

/** True when `path` is the given folder or sits anywhere beneath it. */
function isInFolder(path: string, folder: string): boolean {
	const f = trimSlashes(folder);
	if (f === '') return false; // an unset folder never claims notes
	return path.startsWith(`${f}/`);
}

/** Media type for a vault path, or null when it is in neither typed folder. */
export function typeForPath(
	path: string,
	settings: SomedaySettings,
): MediaType | null {
	const inGames = isInFolder(path, settings.gamesFolder);
	const inAnime = isInFolder(path, settings.animeFolder);
	if (inGames && inAnime) {
		// Overlapping config (one nested in the other): the deeper folder wins.
		return trimSlashes(settings.gamesFolder).length >=
			trimSlashes(settings.animeFolder).length
			? 'game'
			: 'anime';
	}
	if (inGames) return 'game';
	if (inAnime) return 'anime';
	return null;
}

export function typeForFile(
	file: TFile,
	settings: SomedaySettings,
): MediaType | null {
	return typeForPath(file.path, settings);
}

/** The folder a note of `type` belongs in. */
export function folderForType(
	settings: SomedaySettings,
	type: MediaType,
): string {
	return trimSlashes(
		type === 'game' ? settings.gamesFolder : settings.animeFolder,
	);
}
