#!/usr/bin/env python3
"""One-time migration of the user's legacy game/anime notes into someday-lib's
frontmatter schema (see SPEC.md §4 and src/model/frontmatter.ts).

Legacy notes come in two flavours, detected by their `url` / `dataSource`:

  * Steam games  (name/gameSeries/main/... , store.steampowered.com URL)
  * MAL anime    (dataSource: MALAPI, myanimelist.net URL)

Target schema keys (in the order src/model/frontmatter.ts writes them):

    title, status, rating, source, source_id, url, cover, added, started,
    completed, episodes_total, episodes_watched, format, season_year,
    release_date, platforms

`description` (the old `plot`) is not frontmatter — it becomes the note body,
matching how the plugin creates notes (body = trimmed description).

For anime, `source` is queried live against AniList: if the title is found we
adopt AniList's id/url (and cover); if not, we keep only the original MAL url
and leave `source`/`source_id` unset.

Usage:
    python3 migrate_frontmatter.py <input_dir> [--out DIR | --in-place]
                                   [--dry-run] [--no-anilist] [--added DATE]

Defaults to a dry run that prints the transformed frontmatter for each file.
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml

# --- Tunables (confirmed with the user) -------------------------------------

# Legacy game `userRating` is on a 1-5 scale; our `rating` is 1-10 -> multiply.
GAME_RATING_FACTOR = 2

# Legacy anime qualitative `score` -> numeric 1-10 rating.
ANIME_SCORE_TO_RATING = {"good": 8, "ok": 5, "bad": 3}

# Legacy status vocab -> plugin status vocab (SPEC §2).
#   game : wishlist / backlog / playing / completed / dropped
#   anime: planning / watching / completed / paused / dropped
GAME_STATUS_MAP = {
    "completed": "completed",
    "not_started": "backlog",
    "backlog": "backlog",
    "playing": "playing",
    "in_progress": "playing",
    "wishlist": "wishlist",
    "plan_to_play": "wishlist",
    "dropped": "dropped",
    "abandoned": "dropped",
    "on_hold": "backlog",  # no game-side "paused" state
}
ANIME_STATUS_MAP = {
    "completed": "completed",
    "watching": "watching",
    "in_progress": "watching",
    "planning": "planning",
    "plan_to_watch": "planning",
    "not_started": "planning",
    "paused": "paused",
    "on_hold": "paused",
    "dropped": "dropped",
}

# Legacy anime `type`/`subType` -> our `format`, used only when AniList has no
# format for a match (or there is no match).
ANIME_TYPE_TO_FORMAT = {
    "series": "TV",
    "tv": "TV",
    "movie": "Movie",
    "ova": "OVA",
    "ona": "ONA",
    "special": "Special",
    "music": "Music",
}

# The order src/model/frontmatter.ts emits keys, so migrated notes look native.
FIELD_ORDER = [
    "title", "title_romaji", "status", "rating", "source", "source_id", "url", "cover",
    "added", "started", "completed", "episodes_total", "episodes_watched",
    "format", "season_year", "release_date", "platforms",
]

ANILIST_ENDPOINT = "https://graphql.anilist.co"
ANILIST_QUERY = """
query ($q: String) {
  Page(perPage: 10) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      coverImage { large }
      episodes
      format
      seasonYear
      siteUrl
    }
  }
}
"""
ANILIST_MATCH_THRESHOLD = 0.6  # difflib ratio below which we treat as "not found"


# --- Frontmatter I/O --------------------------------------------------------

FM_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)\Z", re.DOTALL)


def parse_note(text: str) -> tuple[dict, str]:
    """Split a note into (frontmatter dict, body). Missing FM -> ({}, text)."""
    m = FM_RE.match(text)
    if not m:
        return {}, text
    data = yaml.safe_load(m.group(1)) or {}
    if not isinstance(data, dict):
        data = {}
    return data, m.group(2)


def dump_note(fm: dict, body: str) -> str:
    """Render frontmatter (in FIELD_ORDER) + body back into a note string."""
    ordered = {k: fm[k] for k in FIELD_ORDER if k in fm}
    # Any stray keys not in the schema order (shouldn't happen) go last.
    ordered.update({k: v for k, v in fm.items() if k not in ordered})
    yaml_text = yaml.safe_dump(
        ordered, sort_keys=False, allow_unicode=True, default_flow_style=False
    ).rstrip("\n")
    body = body.strip()
    tail = f"\n{body}\n" if body else "\n"
    return f"---\n{yaml_text}\n---\n{tail}"


# --- Small helpers ----------------------------------------------------------

def norm_str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def to_int(v) -> int | None:
    try:
        if v is None or v == "":
            return None
        return int(float(v))
    except (TypeError, ValueError):
        return None


def norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


DATE_FORMATS = ["%Y-%m-%d", "%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%d %B %Y"]


def parse_release_date(value) -> str | None:
    """Normalize a release string to YYYY-MM-DD; fall back to a bare year."""
    s = norm_str(value)
    if not s:
        return None
    for fmt in DATE_FORMATS:
        try:
            return dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    m = re.search(r"\b(19|20)\d{2}\b", s)
    if m:
        return m.group(0)  # only a year was available
    print(f"    ! could not parse release date {s!r}; keeping as-is", file=sys.stderr)
    return s


def to_iso_date(value) -> str | None:
    """Legacy completed/date fields are already ISO or a date; coerce to str."""
    if isinstance(value, dt.date):
        return value.isoformat()
    return norm_str(value)


def prune(fm: dict) -> dict:
    """Drop keys whose value is None/''/empty list (mirrors writeItem)."""
    out = {}
    for k, v in fm.items():
        if v is None or v == "" or (isinstance(v, list) and not v):
            continue
        out[k] = v
    return out


# --- Type detection ---------------------------------------------------------

def detect_type(fm: dict) -> str | None:
    url = str(fm.get("url") or "")
    ds = str(fm.get("dataSource") or "").upper()
    if "steampowered.com" in url or "gameSeries" in fm:
        return "game"
    if "myanimelist.net" in url or "anilist.co" in url or "MAL" in ds or "ANILIST" in ds:
        return "anime"
    # Fall back on distinguishing keys.
    if "englishTitle" in fm or "episodes" in fm:
        return "anime"
    if "main" in fm or "perfectionist" in fm:
        return "game"
    return None


# --- Game transform ---------------------------------------------------------

STEAM_APPID_RE = re.compile(r"/app/(\d+)")


def transform_game(fm: dict, basename: str) -> tuple[dict, str]:
    out: dict = {}
    out["title"] = norm_str(fm.get("name")) or basename

    status = norm_str(fm.get("status"))
    if status:
        mapped = GAME_STATUS_MAP.get(status.lower())
        if mapped is None:
            print(f"    ! unknown game status {status!r}; passing through", file=sys.stderr)
            mapped = status
        out["status"] = mapped

    user_rating = to_int(fm.get("userRating"))
    if user_rating is not None:
        out["rating"] = max(1, min(10, user_rating * GAME_RATING_FACTOR))

    url = norm_str(fm.get("url"))
    if url:
        out["url"] = url
        m = STEAM_APPID_RE.search(url)
        if m:
            out["source"] = "steam"
            out["source_id"] = m.group(1)

    out["cover"] = norm_str(fm.get("poster"))
    out["completed"] = to_iso_date(fm.get("dateCompleted"))
    out["release_date"] = parse_release_date(fm.get("released"))

    platforms = fm.get("platforms")
    if isinstance(platforms, list):
        out["platforms"] = [str(p).strip() for p in platforms if norm_str(p)]
    elif norm_str(platforms):
        out["platforms"] = [norm_str(platforms)]

    body = norm_str(fm.get("plot")) or ""
    return prune(out), body


# --- Anime transform --------------------------------------------------------

class AniListError(Exception):
    """A network/parse failure talking to AniList (as opposed to a genuine miss)."""


def anilist_search(title: str, year: int | None, session_cache: dict) -> dict | None:
    """Best AniList media match for `title`, or None for a genuine no-match.

    Retries transient network errors; raises AniListError only after they are
    exhausted, so a blip is never mistaken for "not on AniList".
    """
    key = title.lower()
    if key in session_cache:  # only genuine responses are cached
        return session_cache[key]

    payload = json.dumps({"query": ANILIST_QUERY, "variables": {"q": title}}).encode()
    req = urllib.request.Request(
        ANILIST_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            # AniList sits behind Cloudflare, which 403s the default urllib UA.
            "User-Agent": "someday-lib-migration/1.0 (Obsidian plugin migration)",
        },
    )
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode())
            media = (data.get("data") or {}).get("Page", {}).get("media", []) or []
            result = _pick_best(media, title, year)
            session_cache[key] = result
            time.sleep(0.8)  # be gentle: AniList allows ~90 req/min
            return result
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))  # back off before retrying
    raise AniListError(str(last_err))


def _pick_best(media: list, title: str, year: int | None) -> dict | None:
    want = norm_title(title)
    best, best_score = None, 0.0
    for m in media:
        titles = m.get("title") or {}
        cands = [t for t in (titles.get("romaji"), titles.get("english")) if t]
        score = max((difflib.SequenceMatcher(None, want, norm_title(c)).ratio()
                     for c in cands), default=0.0)
        if year and m.get("seasonYear") == year:
            score += 0.15  # nudge same-year matches ahead
        if score > best_score:
            best, best_score = m, score
    if best is None or best_score < ANILIST_MATCH_THRESHOLD:
        return None
    return best


def transform_anime(fm: dict, basename: str, cache: dict, use_anilist: bool) -> tuple[dict, str]:
    out: dict = {}
    # MAL stores the romaji title in `title` and the English one in `englishTitle`.
    romaji = norm_str(fm.get("title"))
    english = norm_str(fm.get("englishTitle"))
    query = romaji or english or basename

    status_raw = norm_str(fm.get("status"))
    status = None
    if status_raw:
        status = ANIME_STATUS_MAP.get(status_raw.lower())
        if status is None:
            print(f"    ! unknown anime status {status_raw!r}; passing through", file=sys.stderr)
            status = status_raw
        out["status"] = status

    score = norm_str(fm.get("score"))
    if score and score.lower() in ANIME_SCORE_TO_RATING:
        out["rating"] = ANIME_SCORE_TO_RATING[score.lower()]

    year = to_int(fm.get("year"))
    episodes = to_int(fm.get("episodes"))
    mal_url = norm_str(fm.get("url"))
    cover = norm_str(fm.get("poster"))
    fmt = None

    match = None
    lookup_failed = False
    if use_anilist:
        try:
            match = anilist_search(query, year, cache)
        except AniListError as e:
            lookup_failed = True
            print(f"    ! AniList lookup failed for {query!r} ({e}); kept MAL "
                  f"url — re-run to retry", file=sys.stderr)

    if match:
        mt = match.get("title") or {}
        english = norm_str(mt.get("english")) or english
        romaji = norm_str(mt.get("romaji")) or romaji
        out["source"] = "anilist"
        out["source_id"] = str(match["id"])
        out["url"] = match.get("siteUrl") or mal_url
        cover = (match.get("coverImage") or {}).get("large") or cover
        fmt = match.get("format")
        if match.get("seasonYear") and not year:
            year = match["seasonYear"]
        print(f"    ~ AniList match: {romaji or english} (id {match['id']})")
    else:
        out["url"] = mal_url  # source/source_id left unset
        if use_anilist and not lookup_failed:
            print("    ~ no AniList match; preserving MAL url")

    # English is the primary/display title; romaji is stored alongside when it
    # differs, mirroring how the plugin's AniList adapter fills both.
    title = english or romaji or basename
    out["title"] = title
    if romaji and romaji != title:
        out["title_romaji"] = romaji

    out["cover"] = cover
    out["completed"] = to_iso_date(fm.get("completedDate"))

    if episodes is not None:
        out["episodes_total"] = episodes
        # Legacy notes track no per-episode progress; a completed show is fully
        # watched, everything else starts at unset.
        if status == "completed":
            out["episodes_watched"] = episodes

    if not fmt:
        legacy = norm_str(fm.get("subType")) or norm_str(fm.get("type"))
        if legacy:
            fmt = ANIME_TYPE_TO_FORMAT.get(legacy.lower(), legacy)
    out["format"] = fmt
    out["season_year"] = year

    body = norm_str(fm.get("plot")) or ""
    return prune(out), body


# --- Driver -----------------------------------------------------------------

def migrate_file(path: Path, args, cache: dict) -> str | None:
    text = path.read_text(encoding="utf-8")
    fm, _old_body = parse_note(text)
    media_type = detect_type(fm)
    if media_type is None:
        print(f"  SKIP {path.name}: could not determine game/anime", file=sys.stderr)
        return None

    print(f"  {media_type.upper():5} {path.name}")
    if media_type == "game":
        new_fm, body = transform_game(fm, path.stem)
    else:
        new_fm, body = transform_anime(fm, path.stem, cache, args.use_anilist)

    if args.added:
        new_fm["added"] = args.added
    return dump_note(new_fm, body)


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate legacy notes to someday-lib schema.")
    ap.add_argument("input", type=Path, help="directory of legacy .md notes")
    ap.add_argument("--out", type=Path, help="write migrated notes here (default: <input>/../migrated)")
    ap.add_argument("--in-place", action="store_true", help="overwrite the input files")
    ap.add_argument("--dry-run", action="store_true", help="print results, write nothing")
    ap.add_argument("--no-anilist", dest="use_anilist", action="store_false",
                    help="skip AniList lookups (keep MAL urls only)")
    ap.add_argument("--added", metavar="YYYY-MM-DD", nargs="?", const=None,
                    help="stamp every note's `added` with this date")
    args = ap.parse_args()

    if args.added is None and "--added" in sys.argv:
        args.added = dt.date.today().isoformat()

    if not args.input.is_dir():
        print(f"error: {args.input} is not a directory", file=sys.stderr)
        return 2

    if args.in_place:
        out_dir = args.input
    else:
        out_dir = args.out or (args.input.parent / "migrated")

    files = sorted(args.input.glob("*.md"))
    if not files:
        print(f"no .md files in {args.input}", file=sys.stderr)
        return 1

    mode = "DRY RUN" if args.dry_run else ("IN-PLACE" if args.in_place else f"-> {out_dir}")
    print(f"Migrating {len(files)} note(s) [{mode}]"
          f"{' (AniList off)' if not args.use_anilist else ''}\n")

    cache: dict = {}
    written = 0
    for path in files:
        result = migrate_file(path, args, cache)
        if result is None:
            continue
        if args.dry_run:
            print("  " + "\n  ".join(result.splitlines()) + "\n")
            continue
        if not args.in_place:
            out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / path.name).write_text(result, encoding="utf-8")
        written += 1

    if not args.dry_run:
        print(f"\nWrote {written} note(s) to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
