---
name: resolve-playlist
description: Resolve YouTube video IDs for unmatched tracks in a stored playlist. Uses yt-dlp (no API quota). Scores candidates on channel quality, duration match, and title similarity.
triggers:
  - "resolve youtube ids"
  - "resolve playlist"
  - "find youtube videos"
  - "match youtube"
---

# resolve-playlist

Resolve YouTube video IDs for tracks in the local database using yt-dlp.

## When to Use

- After importing a playlist, user wants to find YouTube matches
- Running batch resolution on multiple playlists

## Prerequisites

- `yt-dlp` must be installed: `brew install yt-dlp` or `pip install yt-dlp`
- Playlist must already be in the DB (run save-playlist or sync-spotify first)

## Running the Resolver

```bash
spoti-bye resolve --playlist=<id> --threshold=5 --delay=1500
```

Options:
- `--playlist=ID` — required
- `--threshold=N` — minimum score to auto-accept (default: 5; use 1 for aggressive auto-accept)
- `--delay=MS` — delay between searches in ms (default: 1500; increase if hitting bot detection)
- `--dry-run` — preview without writing to DB
- `--verbose` — show scoring details for each candidate

## Scoring System

Each YouTube candidate is scored on:
1. **Channel quality**: VEVO/official artist channel (+3), Topic channel (+2), name match (+2)
2. **Duration match**: Within 5s (+3), 15s (+2), 30s (+1), >60s off = skip
3. **Negative keywords**: cover/remix/live/karaoke/acoustic = skip unless in original title
4. **Title similarity**: artist+title match (+2), title only (+1)
5. **View count**: >1M views (+1)

Tracks scoring below threshold go to a review file at `~/.spoti-bye/youtube-review-<id>.json`.

## After Resolving

```bash
spoti-bye review    # process flagged tracks
```

## Bot Detection

If yt-dlp starts failing with "Sign in to confirm", increase `--delay` or wait a few hours.

## Batch Processing All Playlists

```bash
for id in $(sqlite3 ~/.spoti-bye/playlists.db "SELECT DISTINCT pt.playlist_id FROM songs s JOIN playlist_tracks pt ON pt.song_id = s.id WHERE s.youtube_video_id IS NULL ORDER BY pt.playlist_id;"); do
  echo "=== Playlist $id ==="
  spoti-bye resolve --playlist=$id --threshold=1 --delay=1500
done
```
