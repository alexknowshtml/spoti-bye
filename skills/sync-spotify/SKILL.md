---
name: sync-spotify
description: Bulk import or sync all Spotify playlists from an Exportify zip export. Detects new, updated, and unchanged playlists. YouTube IDs are preserved on updates.
triggers:
  - "sync spotify"
  - "sync my playlists"
  - "import exportify"
  - "bulk import playlists"
---

# sync-spotify

Sync all Spotify playlists from an Exportify zip export into the local database.

## When to Use

- User has exported all their Spotify playlists via Exportify
- User wants to do the initial bulk import
- User wants to update existing playlists with new tracks

## How to Export from Spotify

1. Go to https://exportify.net
2. Log in with Spotify
3. Click "Export All" to download a zip of all playlists as CSVs
4. Each CSV contains: track name, artist, album, duration, Spotify audio features, and more

## Running the Sync

```bash
spoti-bye sync --zip=~/Downloads/spotify_playlists.zip
```

Or if already unzipped:
```bash
spoti-bye sync --dir=/path/to/csv/folder
```

Add `--dry-run` to preview changes without writing to the DB.

## What It Does

- **New playlists**: imported with all tracks and metadata
- **Updated playlists**: rebuilt with new track list; YouTube IDs are preserved (they live on the `songs` table, not the playlist)
- **Unchanged playlists**: sync timestamp updated only
- **Missing playlists**: flagged in output but not deleted

## After Syncing

Run the resolver to find YouTube video IDs:
```bash
spoti-bye list          # find playlist IDs
spoti-bye resolve --playlist=<id> --threshold=5
```
