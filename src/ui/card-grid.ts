import type { ItemData } from '../types';
import type { TitleLanguage } from '../settings';
import { displayTitle } from '../model/title';

// Shared, framework-agnostic renderer: ItemData[] + a container -> a card grid.
// It knows nothing about Bases or the vault; callers wire up onOpen.

/**
 * The shape of the cover box. The sources ship opposite ratios — AniList covers
 * are 230x320 portrait, Steam header art is 460x215 landscape — and a cover in
 * the wrong box is cropped to a heavy center zoom. Applies to a whole grid, not
 * a card: uniform boxes are what makes the rows line up.
 */
export type CardLayout = 'portrait' | 'landscape';

export interface CardGridOptions {
	onOpen: (item: ItemData) => void;
	/** Which stored title to show on each card. */
	titleLanguage: TitleLanguage;
	/** Cover shape for the grid. Defaults to `portrait`. */
	layout?: CardLayout;
	emptyText?: string;
}

function episodeProgress(item: ItemData): string | undefined {
	if (item.type !== 'anime') return undefined;
	if (item.episodesWatched === undefined && item.episodesTotal === undefined) {
		return undefined;
	}
	const watched = item.episodesWatched ?? 0;
	const total = item.episodesTotal ?? '?';
	return `${watched}/${total}`;
}

function renderCard(
	grid: HTMLElement,
	item: ItemData,
	onOpen: (item: ItemData) => void,
	titleLanguage: TitleLanguage,
): void {
	const title = displayTitle(item, titleLanguage);
	const card = grid.createDiv({ cls: 'someday-card' });
	card.setAttribute('role', 'button');
	card.tabIndex = 0;
	card.setAttribute('aria-label', title);

	const cover = card.createDiv({ cls: 'someday-card-cover' });
	if (item.cover) {
		const img = cover.createEl('img', {
			cls: 'someday-card-img',
			attr: { src: item.cover, alt: title, loading: 'lazy' },
		});
		img.addEventListener('error', () => {
			img.remove();
			cover.addClass('is-broken');
		});
	} else {
		cover.addClass('is-broken');
	}

	const body = card.createDiv({ cls: 'someday-card-body' });
	body.createDiv({ cls: 'someday-card-title', text: title });

	const badges = body.createDiv({ cls: 'someday-card-badges' });
	if (item.status) {
		badges.createSpan({
			cls: `someday-badge someday-status is-${item.status}`,
			text: item.status,
		});
	}
	if (item.rating !== undefined) {
		badges.createSpan({
			cls: 'someday-badge someday-rating',
			text: `★ ${item.rating}`,
		});
	}
	const progress = episodeProgress(item);
	if (progress) {
		badges.createSpan({
			cls: 'someday-badge someday-progress',
			text: progress,
		});
	}

	const open = () => onOpen(item);
	card.addEventListener('click', open);
	card.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' || evt.key === ' ') {
			evt.preventDefault();
			open();
		}
	});
}

/** Render (replacing any prior content) the cards for `items` into `container`. */
export function renderCards(
	container: HTMLElement,
	items: ItemData[],
	opts: CardGridOptions,
): void {
	container.empty();
	if (items.length === 0) {
		container.createDiv({
			cls: 'someday-empty',
			text: opts.emptyText ?? 'No items yet.',
		});
		return;
	}
	const grid = container.createDiv({
		cls:
			opts.layout === 'landscape'
				? 'someday-grid is-landscape'
				: 'someday-grid',
	});
	for (const item of items) {
		renderCard(grid, item, opts.onOpen, opts.titleLanguage);
	}
}
