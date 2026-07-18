# someday-lib — implementation spec

An Obsidian plugin to track **games** and **anime** as notes, render them as a
card gallery through a **custom Bases view**, and import new entries from
**Steam** and **AniList** (both keyless).

Status: draft. Phased below. Resolved decisions are in §6; remaining knobs are
plain settings.

---

## 1. Product summary

Three capabilities:

1. **Represent** — each game/anime is a Markdown note whose frontmatter holds
   its metadata (status, rating, dates, episodes…). A custom **Bases card view**
   renders a folder of these notes as a cover-image gallery.
2. **Edit** — tapping a card opens a modal for the common edits: change
   **status** (select), set **rating**, pick **completed date**, and for anime
   set **episodes watched**.
3. **Import** — a command asks for a search query, lets the user pick one
   upstream (**Steam** *or* **AniList**), queries it without any API key, shows
   the results, and creates local notes for the ones the user selects.

Design constraint from `AGENTS.md`: local/offline by default, network only for
the explicit import feature, disclose it, keep `main.ts` thin, split modules,
mobile-friendly (`requestUrl`, no Node APIs → `isDesktopOnly: false`).

---

## 2. Resolved shape

- **View:** custom `BasesView` (Obsidian 1.10.0). The user creates a base
  scoped to a folder and selects the `someday-cards` view. **One base = one
  folder = one media type. No mixing** — a Games base shows games, an Anime base
  shows anime.
- **Typing:** no `type` frontmatter. **Media type is derived from the folder**
  the note lives in (settings hold the Games folder path and the Anime folder
  path). Separate folders, `Games/` and `Anime/`.
- **Covers:** **remote URL only** — the upstream image URL is stored in
  frontmatter and used directly in `<img>`. No downloading, no attachments.
- **Import:** one selected upstream per search; media type follows the source
  (Steam → game, AniList → anime).
- **Rating:** 1–10 (AniList 0–100 → /10).
- **Status vocab (per type):** anime = planning / watching / completed / paused
  / dropped; game = wishlist / backlog / playing / completed / dropped.

---

## 3. Architecture at a glance

```
src/
  main.ts                 # lifecycle only: load settings, register command/ribbon/bases view
  settings.ts             # settings interface, defaults, settings tab
  types.ts                # ItemData, SearchResult, MediaType, Status, adapter iface
  model/
    frontmatter.ts        # read/write frontmatter <-> ItemData (processFrontMatter)
    note-writer.ts        # create note from ItemData (folder by type, filename)
    media-type.ts         # derive 'anime'|'game' from a file's folder + settings
  sources/
    adapter.ts            # SourceAdapter interface + registry
    steam.ts              # SteamAdapter (storesearch + appdetails)
    anilist.ts            # AniListAdapter (GraphQL)
    http.ts               # requestUrl wrapper: JSON, errors, rate-limit backoff
  ui/
    card-grid.ts          # SHARED renderer: ItemData[] -> DOM card grid
    edit-modal.ts         # tap-to-edit modal
    import-modal.ts       # query + upstream select + results + multi-select
  view/
    bases-view.ts         # SomedayCardsView extends BasesView -> card-grid
    codeblock.ts          # optional: ```someday-gallery code block -> card-grid
```

**Key design decision:** the card renderer (`ui/card-grid.ts`) takes a plain
`ItemData[]` + a container and knows nothing about Bases. The Bases view maps
its `BasesEntry` rows into `ItemData[]` (deriving type from each entry's folder)
and hands them over; the optional code-block processor does the same.

---

## 4. Data model

One note per item. Frontmatter drives everything (Bases queries it, the cards
render it, the modal edits it). **No `type` field — the folder is the type.**

```yaml
---
title: Frieren: Beyond Journey's End
status: watching
rating: 9                # 1–10
source: anilist          # anilist | steam
source_id: 154587
url: https://anilist.co/anime/154587
cover: https://s4.anilist.co/.../cover.jpg   # remote URL, used directly
added: 2026-07-18
started: 2026-07-10
completed:
# anime only
episodes_total: 28
episodes_watched: 12
format: TV
season_year: 2023
# game only (in a Games/ note)
release_date: 2023-09-29
platforms: [PC]
---
Free-text notes / review go in the body.
```

Types (`src/types.ts`):

```ts
export type MediaType = 'anime' | 'game';
export type Source = 'anilist' | 'steam';

export interface ItemData {
  type: MediaType;                 // derived from folder, not stored
  title: string;
  source: Source;
  sourceId: string;
  url?: string;
  cover?: string;                  // remote URL
  status?: string;
  rating?: number;                 // 1–10
  added?: string;
  started?: string;
  completed?: string;
  // anime
  episodesTotal?: number;
  episodesWatched?: number;
  format?: string;
  seasonYear?: number;
  // game
  releaseDate?: string;
  platforms?: string[];
  description?: string;
}

export interface SearchResult {   // lightweight, for the results list
  source: Source;
  sourceId: string;
  title: string;
  year?: number;
  thumb?: string;
  subtitle?: string;              // e.g. "TV · 28 eps" or "Game · 2023"
}
```

---

## 5. External sources (keyless)

All network calls go through Obsidian's `requestUrl` (bypasses CORS, works on
mobile). One `SourceAdapter` per upstream:

```ts
export interface SourceAdapter {
  id: Source;
  label: string;
  type: MediaType;                         // steam->game, anilist->anime
  search(query: string): Promise<SearchResult[]>;
  getDetails(sourceId: string): Promise<ItemData>;
}
```

### 5.1 Steam (games)

- **Search:** `GET https://store.steampowered.com/api/storesearch/?term=<q>&cc=<cc>&l=<lang>`
  → `{ items: [{ id, name, tiny_image, price }] }`. Keyless.
- **Details:** `GET https://store.steampowered.com/api/appdetails?appids=<id>&cc=<cc>&l=<lang>`
  → `header_image`, `short_description`, `genres`, `release_date`, `platforms`.
  Keyless, rate-limited (~200 req / 5 min). On `429` back off ~10s; on `403`
  back off ~5 min. Import is user-paced and low-volume, so this is a guardrail.

### 5.2 AniList (anime)

- Public GraphQL endpoint `https://graphql.anilist.co`, **no key**. One query
  returns search results *and* the detail fields, so search + details can share
  a call (getDetails re-issues by id).

```graphql
query ($q: String) {
  Page(perPage: 12) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      coverImage { large }
      episodes
      format
      seasonYear
      description(asHtml: false)
      siteUrl
    }
  }
}
```

- Rating: AniList 0–100 → /10. Respect `isAdult` per settings (default exclude).

---

## 6. Phases

Each phase is independently testable and leaves the plugin in a working state.

### Phase 0 — Scaffold & rename
- Rename plugin: `manifest.json` id/name/description/author; `package.json` name.
  Pick an `id` now (e.g. `someday-lib`) — **it can never change after release.**
- Set `minAppVersion` to **1.10.0** (Bases view API). `isDesktopOnly: false`.
- Restructure `src/` per §3. Keep `main.ts` to lifecycle only.
- Add `types.ts`; stub `settings.ts` with the real settings: **Games folder
  path, Anime folder path**, Steam `cc`/`lang`, AniList adult filter, status
  vocab per type.
- **Done when:** plugin builds, loads, settings tab shows real options.

### Phase 1 — Data model & vault I/O
- `model/media-type.ts`: `typeForFile(file, settings): MediaType | null` by
  matching the file's folder against the configured Games/Anime paths.
- `model/frontmatter.ts`: `readItem(file): ItemData` (frontmatter from
  `metadataCache` + type from folder); `writeItem(file, patch)` via
  `app.fileManager.processFrontMatter`.
- `model/note-writer.ts`: `createNote(item): TFile` — folder chosen by
  `item.type`, safe/unique filename from title, write frontmatter + body.
- **Done when:** a hardcoded `ItemData` round-trips to a note (in the right
  folder) and back, with type inferred from the folder.

### Phase 2 — Source adapters
- `sources/http.ts`: `getJson(url)` / `postJson(url, body)` over `requestUrl`
  with error normalization + rate-limit backoff.
- `sources/steam.ts` + `sources/anilist.ts` implementing `SourceAdapter`.
- `sources/adapter.ts`: registry keyed by `Source`.
- **Done when:** a temporary command logs search + details JSON for a query on
  each source.

### Phase 3 — Import UI
- `ui/import-modal.ts`: query input + **single upstream selector** (Steam or
  AniList), "Search" → results list with thumbnails, multi-select, "Add
  selected" → `getDetails` + `createNote` (into that source's folder) per pick,
  progress `Notice`, optional "open note".
- Command **Add game or anime** + ribbon icon.
- **Done when:** searching one upstream and picking results creates correct
  notes in the correct folder.

### Phase 4 — Card grid renderer (shared)
- `ui/card-grid.ts`: `renderCards(container, items, { onOpen })` — responsive
  grid, cover `<img>` from the remote URL, title, status + rating badges, anime
  episode progress. Click → `onOpen(item)`.
- CSS in `styles.css`.
- **Done when:** rendering an array of items shows the gallery; clicking fires
  the callback.

### Phase 5 — The custom Bases view
Use the **`BasesView`** class (Obsidian 1.10.0, `extends Component`):

```ts
import { BasesView } from 'obsidian';

export class SomedayCardsView extends BasesView {
  type = 'someday-cards';                 // the view's type id
  onload()        { /* build container once */ }
  onDataUpdated() { /* map this.data (BasesEntry[]) -> ItemData[]; renderCards */ }
}
```

- Register a `BasesViewFactory` in plugin `onload` (via
  `plugin.registerBasesView(type, factory)` — confirm exact registrar name
  against the 1.10 `obsidian.d.ts`).
- `onDataUpdated()` fires whenever the query result changes — **the view
  refreshes itself**; don't cache `this.data`.
- Map each `BasesEntry` → `ItemData`: frontmatter properties + type derived from
  the entry file's folder.
- Ship two sample `.base` files (one scoped to the Games folder, one to the
  Anime folder, both using view type `someday-cards`) so users get galleries out
  of the box. One base = one folder = one type; no mixed base.
- **"Add" affordance in the view** opens the **import modal** (§Phase 3),
  pre-selecting the upstream that matches the base's folder type (Games base →
  Steam, Anime base → AniList). Not Obsidian's `createFileForView`.
- **Optional** `view/codeblock.ts`: a ```` ```someday-gallery ```` processor
  (points at a folder) rendering the same grid for embedding outside a base.
- **Done when:** opening a Games base and an Anime base each shows a live
  gallery that updates as notes change.

### Phase 6 — Edit modal
- `ui/edit-modal.ts` opened from a card:
  - **Status** dropdown (vocab from settings, per type).
  - **Rating** input (1–10).
  - **Completed date** date picker.
  - **Episodes watched** (anime only): number with −/＋ and "set to total".
  - Save → `writeItem`. The Bases view repaints via `onDataUpdated`; the
    code-block path listens to `metadataCache` `changed`.
- **Done when:** editing a card persists to frontmatter and the card updates.

### Phase 7 — Polish & release
- Settings tab complete; empty/error/loading states; README with the network
  disclosure (Steam + AniList, no keys, no telemetry); mobile pass; `npm run
  lint` clean; version/`versions.json`; release artifacts.

---

## 7. Risks / open questions

- **Bases registrar name/signature** — the `BasesView` class and lifecycle are
  confirmed for 1.10.0; verify the exact `plugin.registerBasesView(...)` /
  `BasesViewFactory` call and `BasesEntry` property access against the installed
  `obsidian.d.ts` before Phase 5.
- **Folder = type coupling** — moving a note between the Games/Anime folders
  changes its type; renaming a configured folder must be handled (re-point
  setting). Notes outside both folders have no type → excluded.
- **Steam `appdetails` rate limits / regional variance** — `cc`/`l` change
  price/availability; some appids return `success:false`. Handle per-item
  failures gracefully in the import list.
- **Remote covers** need network to display and can break if upstream rotates
  URLs (accepted trade-off; download mode intentionally out of scope).
