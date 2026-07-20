import type { Vault } from 'obsidian';

// Rules for turning a title into a safe, unique note path. Single home for the
// "which characters are allowed in a filename" decision.

// Characters Obsidian / the filesystem disallow in a note basename.
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/** A filesystem-safe basename derived from a title (never empty). */
export function safeFileName(title: string): string {
	const cleaned = title
		.replace(ILLEGAL, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\.+$/, ''); // trailing dots are invalid on Windows
	return cleaned.length > 0 ? cleaned : 'Untitled';
}

/**
 * A vault path under `folder` for `base` that no existing file occupies,
 * appending " (2)", " (3)", … on collision.
 */
export function uniquePath(vault: Vault, folder: string, base: string): string {
	const dir = folder ? `${folder}/` : '';
	let candidate = `${dir}${base}.md`;
	let n = 2;
	while (vault.getAbstractFileByPath(candidate)) {
		candidate = `${dir}${base} (${n}).md`;
		n += 1;
	}
	return candidate;
}
