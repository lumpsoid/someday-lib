import type { ItemData } from '../types';

// Shared, framework-agnostic renderer: ItemData[] + a container -> a card grid.
// It knows nothing about Bases or the vault; callers wire up onOpen.

export interface CardGridOptions {
	onOpen: (item: ItemData) => void;
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
): void {
	const card = grid.createDiv({ cls: 'someday-card' });
	card.setAttribute('role', 'button');
	card.tabIndex = 0;
	card.setAttribute('aria-label', item.title);

	const cover = card.createDiv({ cls: 'someday-card-cover' });
	if (item.cover) {
		const img = cover.createEl('img', {
			cls: 'someday-card-img',
			attr: { src: item.cover, alt: item.title, loading: 'lazy' },
		});
		img.addEventListener('error', () => {
			img.remove();
			cover.addClass('is-broken');
		});
	} else {
		cover.addClass('is-broken');
	}

	const body = card.createDiv({ cls: 'someday-card-body' });
	body.createDiv({ cls: 'someday-card-title', text: item.title });

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
	const grid = container.createDiv({ cls: 'someday-grid' });
	for (const item of items) {
		renderCard(grid, item, opts.onOpen);
	}
}
