#!/usr/bin/env bun
const [,, command, ...rest] = process.argv;

function showHelp() {
  console.log(`spoti-bye — Spotify to YouTube playlist tool

Usage: spoti-bye <command> [options]

Commands:
  import    Import a Spotify playlist from Exportify CSV or JSON
  list      List playlists in your local database
  create    Create a YouTube playlist from tracks stored in the DB
  auth      Authorize with YouTube OAuth (required for create)
  resolve   Resolve YouTube video IDs for unmatched tracks (via yt-dlp)
  review    Process flagged tracks from review files
  sync      Sync all playlists from an Exportify zip export

Examples:
  spoti-bye import --name="My Playlist" --from-csv=exported.csv
  spoti-bye sync --zip=~/Downloads/spotify_playlists.zip
  spoti-bye resolve --playlist=1 --threshold=5
  spoti-bye list
  spoti-bye auth
  spoti-bye create --from-db=1 --name="My Playlist" --save

Run spoti-bye <command> --help for command-specific options.
DB location: ${process.env.PLAYLIST_DB_PATH || '~/.spoti-bye/playlists.db'}
`);
}

const dispatch = async (file: string, extraFlags: string[] = []) => {
  process.argv = [process.argv[0], process.argv[1], ...extraFlags, ...rest];
  const mod = await import(file);
  if (typeof mod.main === 'function') await mod.main();
};

switch (command) {
  case 'import': await dispatch('./playlist.ts', ['--import']); break;
  case 'list':   await dispatch('./playlist.ts', ['--list']); break;
  case 'auth':   await dispatch('./playlist.ts', ['--auth']); break;
  case 'create': await dispatch('./playlist.ts'); break;
  case 'resolve': await dispatch('./resolve.ts'); break;
  case 'review':  await dispatch('./review.ts'); break;
  case 'sync':    await dispatch('./sync.ts'); break;
  default:
    showHelp();
    process.exit(command ? 1 : 0);
}
