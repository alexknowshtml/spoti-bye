#!/usr/bin/env bun
/**
 * Initialize the spoti-bye database.
 * Creates ~/.spoti-bye/ and the SQLite DB with the full schema.
 *
 * Usage: spoti-bye init
 */

import { getDb, closeDb, DB_PATH } from './db';

export async function main() {
  console.log(`Initializing database at: ${DB_PATH}`);
  getDb();
  closeDb();
  console.log('Done. Database ready.');
  console.log('\nNext steps:');
  console.log('  1. Export your Spotify playlists with Exportify (https://exportify.net)');
  console.log('  2. Run: spoti-bye sync --zip=~/Downloads/spotify_playlists.zip');
  console.log('  3. Run: spoti-bye resolve --playlist=<id>');
}

if (import.meta.main) {
  main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
}
