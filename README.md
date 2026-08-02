# Someday Library

Track the games and anime you want to play or watch **someday** as Markdown
notes, and browse them as a cover-image card gallery through a custom
[Bases](https://help.obsidian.md/bases) view. Import entries from **Steam** and
**AniList** without any API keys.

Requires Obsidian **1.10.0+** (for the Bases view API). Works on desktop and
mobile.

## What it does

- **Represent** — each game or anime is a note whose frontmatter holds its
  metadata (status, rating, dates, episodes, cover URL…). The media type is
  derived from the folder the note lives in — a **Games** folder and an **Anime**
  folder, configured in settings. There is no `type` field.
- **Browse** — a custom Bases view, **Someday cards**, renders a folder of these
  notes as a responsive gallery of covers with status/rating badges and anime
  episode progress. One base = one folder = one media type.
- **Edit** — click a card to open a modal for the common edits: **status**,
  **rating** (1–10), **completed date**, and **episodes watched** (anime).
- **Import** — the **Add game or anime** command (also a ribbon icon and the
  **Add** button inside a base) asks for a query, lets you pick Steam *or*
  AniList, shows results, and creates notes for the ones you select.

## Setup

1. Enable the plugin, then open **Settings → Someday Library** and set your
   **Games folder** and **Anime folder** (defaults: `Games` and `Anime`).
2. Create a base for each. Copy the sample files in [`samples/`](samples) into
   your vault — `Games.base` and `Anime.base` — or create a base scoped to the
   folder and choose the **Someday cards** view.
3. Use **Add game or anime** to import your first entries.

You can also embed a gallery anywhere with a code block:

````markdown
```someday-gallery
folder: Anime
```
````

(Omit the folder line to include every typed note.)

## Network use & privacy disclosure

This plugin is offline by default. It makes network requests **only** when you
explicitly search or import, to these public endpoints, using no API keys and no
authentication:

- **Steam** — `store.steampowered.com/search/results` (search) and
  `store.steampowered.com/api/appdetails` (details) for games.
- **AniList** — `graphql.anilist.co` (search and details) for anime.

Cover images are stored as remote URLs and loaded directly from the upstream
CDN when a card renders; nothing is downloaded into your vault. No telemetry is
collected and no vault contents are ever transmitted. Only your search query and
the selected item's ID are sent, and only when you act.

All requests go through Obsidian's `requestUrl`, which respects mobile and
avoids CORS issues.

## Development

- Node 18+, `npm install`.
- `npm run dev` — build in watch mode.
- `npm run build` — type-check and produce a production `main.js`.
- `npm run lint` — ESLint with the Obsidian ruleset.

## License

See [LICENSE](LICENSE).
