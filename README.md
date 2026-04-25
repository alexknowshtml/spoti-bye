# spoti-bye

Export your Spotify library to a local SQLite database and resolve YouTube video IDs — no API quota required for matching.

Built with [Bun](https://bun.sh) and [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## What It Does

- Imports Spotify playlists from [Exportify](https://exportify.net) CSV exports into a local SQLite database
- Resolves YouTube video IDs for every track using yt-dlp search (no YouTube API quota needed for matching)
- Scores candidates on channel quality, duration match, title similarity, and negative keywords
- Optionally creates YouTube playlists from your stored tracks via the YouTube Data API

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (for YouTube ID resolution)
- YouTube OAuth credentials (only needed for `spoti-bye create` and `spoti-bye auth`)

```bash
# Install yt-dlp
brew install yt-dlp        # macOS
pip install yt-dlp         # Python
```

## Install

```bash
bun install -g spoti-bye
```

Or clone and run locally:

```bash
git clone https://github.com/alexknowshtml/spoti-bye
cd spoti-bye
bun install
bun src/cli.ts --help
```

## Quick Start

**Step 1: Export your Spotify playlists**

Go to [exportify.net](https://exportify.net), log in with Spotify, and click "Export All" to download a zip of all your playlists as CSVs.

**Step 2: Import into the local database**

```bash
spoti-bye sync --zip=~/Downloads/spotify_playlists.zip
```

**Step 3: Resolve YouTube video IDs**

```bash
spoti-bye list                                    # find playlist IDs
spoti-bye resolve --playlist=1 --threshold=5      # resolve one playlist
```

**Step 4: Review flagged tracks (optional)**

The resolver flags low-confidence matches for manual review. Edit the review file at `~/.spoti-bye/youtube-review-<id>.json`, then:

```bash
spoti-bye review
```

**Step 5: Create a YouTube playlist (optional)**

```bash
spoti-bye auth                              # one-time OAuth setup
spoti-bye create --from-db=1 --name="My Playlist" --save
```

## Commands

| Command | Description |
|---------|-------------|
| `spoti-bye sync --zip=<path>` | Sync all playlists from Exportify zip |
| `spoti-bye import --name="..." --from-csv=<path>` | Import a single playlist from CSV |
| `spoti-bye list` | List all playlists in the database |
| `spoti-bye resolve --playlist=<id>` | Resolve YouTube IDs for a playlist |
| `spoti-bye review` | Process flagged tracks from review files |
| `spoti-bye auth` | Authorize with YouTube OAuth |
| `spoti-bye create --from-db=<id>` | Create a YouTube playlist from stored tracks |

## Configuration

Copy `.env.example` to `.env` and fill in:

```bash
# DB location (default: ~/.spoti-bye/playlists.db)
PLAYLIST_DB_PATH=/path/to/your/playlists.db

# YouTube OAuth (required only for `create` command)
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=

# YouTube API key (optional — uses a separate quota pool for search)
YOUTUBE_API_KEY=
```

### YouTube OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable **YouTube Data API v3**
3. Create an OAuth 2.0 Client ID (application type: Desktop)
4. Download credentials, copy `client_id` and `client_secret` to `.env`
5. Run `spoti-bye auth` to complete the OAuth flow

## Database Schema

The SQLite database at `~/.spoti-bye/playlists.db` has three tables:

- **`playlists`** — one row per playlist (name, Spotify URL, YouTube playlist ID)
- **`songs`** — one row per unique song, keyed by Spotify track URI. Stores all metadata including Spotify audio features (danceability, energy, tempo, etc.) and the resolved YouTube video ID. A song resolved in one playlist is automatically available in all playlists containing it.
- **`playlist_tracks`** — join table linking playlists to songs (position, added_by, added_at)

YouTube video IDs live on `songs`, so resolving a video ID propagates to every playlist containing that track.

## Resolver Scoring

Each YouTube candidate is scored before accepting:

| Signal | Points |
|--------|--------|
| VEVO or official artist channel | +3 |
| Topic/auto-generated channel | +2 |
| Channel name matches artist | +2 |
| Duration within 5s | +3 |
| Duration within 15s | +2 |
| Duration within 30s | +1 |
| Duration off by >60s | skip |
| Artist + title in YouTube title | +2 |
| Title only | +1 |
| Over 1M views | +1 |
| Negative keyword (cover/remix/live/karaoke/etc.) | skip |

Tracks below `--threshold` (default: 5) go to a review file for manual approval.

## Bot Detection

After heavy batch runs, yt-dlp may hit YouTube's bot detection. Workarounds:
- Increase `--delay` (try 3000ms)
- Wait a few hours and retry
- Use `--flat-playlist` mode manually for stuck tracks

## Batch Processing All Playlists

```bash
# Get all playlist IDs with unresolved tracks
sqlite3 ~/.spoti-bye/playlists.db "
  SELECT DISTINCT pt.playlist_id
  FROM songs s JOIN playlist_tracks pt ON pt.song_id = s.id
  WHERE s.youtube_video_id IS NULL
  ORDER BY pt.playlist_id;"

# Run in screen/tmux for overnight batches
for id in 1 2 3 ...; do
  echo "=== Playlist $id ===" 
  spoti-bye resolve --playlist=$id --threshold=1 --delay=1500
done
```

## Claude Code Skills

The `skills/` directory contains drop-in Claude Code skill files for:

- `save-playlist` — import a Spotify URL or CSV via Claude
- `sync-spotify` — bulk sync from Exportify export
- `resolve-playlist` — resolve YouTube IDs interactively
- `playlist-review` — review and process flagged tracks

Copy the `skills/` folder into your Claude Code project's `.claude/skills/` directory.

## License

MIT
