import { MarkdownRenderChild, type TFile } from 'obsidian';
import type SomedayLibPlugin from '../main';
import { typeForFile } from '../model/media-type';
import { renderGallery } from '../ui/gallery';

// Optional embed: ```someday-gallery``` blocks render the same grid for a folder
// outside a base. The block body is a folder path (or `folder: <path>`); an
// empty body means every typed note.

function parseFolder(source: string): string {
	const line = source
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return '';
	const match = /^folder:\s*(.+)$/i.exec(line);
	return (match?.[1] ?? line).replace(/^\/+|\/+$/g, '');
}

class GalleryBlock extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly plugin: SomedayLibPlugin,
		private readonly folder: string,
	) {
		super(containerEl);
	}

	onload(): void {
		// Re-render when any note's metadata changes so edits show up live.
		this.registerEvent(
			this.plugin.app.metadataCache.on('changed', () => this.render()),
		);
		this.render();
	}

	private inScope(file: TFile): boolean {
		if (!typeForFile(file, this.plugin.settings)) return false;
		if (!this.folder) return true;
		return file.path.startsWith(`${this.folder}/`);
	}

	private render(): void {
		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((file) => this.inScope(file));
		renderGallery(
			this.plugin.app,
			this.containerEl,
			files,
			this.plugin.settings,
			{ emptyText: 'No matching notes.' },
		);
	}
}

export function registerGalleryCodeblock(plugin: SomedayLibPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		'someday-gallery',
		(source, el, ctx) => {
			ctx.addChild(new GalleryBlock(el, plugin, parseFolder(source)));
		},
	);
}
