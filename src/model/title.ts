import type { ItemData } from '../types';
import type { TitleLanguage } from '../settings';

/**
 * The title to show for an item under the preferred language. Both variants are
 * stored (English as `title`, romaji as `titleRomaji`); this picks one for
 * display and falls back to the other when the preferred one is absent — so a
 * romaji preference still shows a game's (English-only) title.
 */
export function displayTitle(
	item: Pick<ItemData, 'title' | 'titleRomaji'>,
	lang: TitleLanguage,
): string {
	if (lang === 'romaji') return item.titleRomaji ?? item.title;
	return item.title || (item.titleRomaji ?? '');
}
