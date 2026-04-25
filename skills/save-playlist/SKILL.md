---
name: save-playlist
description: Import a Spotify playlist into the local SQLite database. Supports Spotify URLs (playlist/track/album), Exportify CSVs, and JSON track lists.
triggers:
  - "save this playlist"
  - "save playlist"
  - "import playlist"
  - "add this playlist"
  - "import this spotify"
---

# save-playlist

Import a Spotify playlist into the local spoti-bye database.

## When to Use

- User shares a Spotify playlist, album, or track URL
- User shares an Exportify CSV file
- User wants to catalog a playlist locally

## Step 1: Extract Tracks from Spotify

Use WebFetch on the **embed** URL (gets all tracks, unlike the regular page):

- Playlist: `https://open.spotify.com/embed/playlist/{ID}`
- Album: `https://open.spotify.com/embed/album/{ID}`
- Track: `https://open.spotify.com/embed/track/{ID}`

Extract: playlist name, all tracks with title/artist/duration.

## Step 2: Save to Database

**From Exportify CSV (preferred for bulk):**
```bash
spoti-bye import --name="PLAYLIST NAME" --from-csv=/path/to/exported.csv --source-url="https://open.spotify.com/playlist/{ID}" --source-type=spotify
```

**From JSON file:**
```bash
spoti-bye import --name="PLAYLIST NAME" --tracks=/tmp/tracks.json --source-url="..." --source-type=spotify
```

Track JSON format:
```json
[{"title": "Song", "artist": "Artist", "durationMs": 213000}]
```

## Step 3: Report

Show: playlist name, track count, DB playlist ID. Offer to run the YouTube resolver.

## Notes

- Check if a playlist with the same source URL already exists before importing
- The `--source-url` flag links the DB entry back to the original Spotify playlist
