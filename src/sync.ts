#!/usr/bin/env bun
/**
 * Sync Spotify playlists from an Exportify zip export.
 *
 * Compares CSV data against the local database and applies changes:
 * - New playlists are imported
 * - Existing playlists with changed tracks are updated (YouTube IDs preserved)
 * - Removed playlists are flagged (not deleted)
 *
 * Usage:
 *   spoti-bye sync --zip=~/Downloads/spotify_playlists.zip
 *   spoti-bye sync --dir=/path/to/csv/folder
 *   spoti-bye sync --zip=... --dry-run
 */

import { parseArgs } from "util";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as playlistDb from "./db";
import type { TrackInsert } from "./db";

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function findCol(header: string[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const idx = header.findIndex(h => p.test(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseFloat_(s: string): number | undefined {
  if (!s || s.trim() === '') return undefined;
  const n = parseFloat(s.trim());
  return isNaN(n) ? undefined : n;
}

function parseInt_(s: string): number | undefined {
  if (!s || s.trim() === '') return undefined;
  const n = parseInt(s.trim(), 10);
  return isNaN(n) ? undefined : n;
}

function parseCsvFull(filePath: string): TrackInsert[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const col = {
    trackUri: findCol(header, /^track\s*uri$/i),
    name: findCol(header, /^track\s*name$/i),
    album: findCol(header, /^album\s*name$/i),
    artist: findCol(header, /^artist\s*name/i),
    releaseDate: findCol(header, /^release\s*date$/i),
    duration: findCol(header, /duration\s*\(?ms\)?/i),
    popularity: findCol(header, /^popularity$/i),
    explicit: findCol(header, /^explicit$/i),
    addedBy: findCol(header, /^added\s*by$/i),
    addedAt: findCol(header, /^added\s*at$/i),
    genres: findCol(header, /^genres$/i),
    label: findCol(header, /^record\s*label$/i),
    danceability: findCol(header, /^danceability$/i),
    energy: findCol(header, /^energy$/i),
    key: findCol(header, /^key$/i),
    loudness: findCol(header, /^loudness$/i),
    mode: findCol(header, /^mode$/i),
    speechiness: findCol(header, /^speechiness$/i),
    acousticness: findCol(header, /^acousticness$/i),
    instrumentalness: findCol(header, /^instrumentalness$/i),
    liveness: findCol(header, /^liveness$/i),
    valence: findCol(header, /^valence$/i),
    tempo: findCol(header, /^tempo$/i),
    timeSig: findCol(header, /^time\s*signature$/i),
  };

  if (col.name === -1 || col.artist === -1) return [];

  const tracks: TrackInsert[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const title = c[col.name]?.trim();
    const artist = c[col.artist]?.trim();
    if (!title) continue;

    tracks.push({
      position: tracks.length + 1,
      title,
      artist: artist || '',
      source_track_id: col.trackUri !== -1 ? c[col.trackUri]?.trim() || undefined : undefined,
      album_name: col.album !== -1 ? c[col.album]?.trim() || undefined : undefined,
      release_date: col.releaseDate !== -1 ? c[col.releaseDate]?.trim() || undefined : undefined,
      duration_ms: col.duration !== -1 ? parseInt_(c[col.duration]) : undefined,
      popularity: col.popularity !== -1 ? parseInt_(c[col.popularity]) : undefined,
      explicit: col.explicit !== -1 ? (c[col.explicit]?.trim().toLowerCase() === 'true' ? 1 : 0) : undefined,
      genres: col.genres !== -1 ? c[col.genres]?.trim() || undefined : undefined,
      record_label: col.label !== -1 ? c[col.label]?.trim() || undefined : undefined,
      danceability: col.danceability !== -1 ? parseFloat_(c[col.danceability]) : undefined,
      energy: col.energy !== -1 ? parseFloat_(c[col.energy]) : undefined,
      key: col.key !== -1 ? parseInt_(c[col.key]) : undefined,
      loudness: col.loudness !== -1 ? parseFloat_(c[col.loudness]) : undefined,
      mode: col.mode !== -1 ? parseInt_(c[col.mode]) : undefined,
      speechiness: col.speechiness !== -1 ? parseFloat_(c[col.speechiness]) : undefined,
      acousticness: col.acousticness !== -1 ? parseFloat_(c[col.acousticness]) : undefined,
      instrumentalness: col.instrumentalness !== -1 ? parseFloat_(c[col.instrumentalness]) : undefined,
      liveness: col.liveness !== -1 ? parseFloat_(c[col.liveness]) : undefined,
      valence: col.valence !== -1 ? parseFloat_(c[col.valence]) : undefined,
      tempo: col.tempo !== -1 ? parseFloat_(c[col.tempo]) : undefined,
      time_signature: col.timeSig !== -1 ? parseInt_(c[col.timeSig]) : undefined,
      spotify_added_by: col.addedBy !== -1 ? c[col.addedBy]?.trim() || undefined : undefined,
      spotify_added_at: col.addedAt !== -1 ? c[col.addedAt]?.trim() || undefined : undefined,
    });
  }
  return tracks;
}

function trackListFingerprint(tracks: Array<{ source_track_id?: string | null; title: string; artist: string }>): string {
  return tracks.map(t => t.source_track_id || `${t.artist}::${t.title}`).join('|');
}

export async function main() {
  const { values } = parseArgs({
    options: {
      zip: { type: "string" },
      dir: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.zip && !values.dir) {
    console.error("Usage: spoti-bye sync --zip=<path> [--dry-run]");
    console.error("       spoti-bye sync --dir=<csv-folder> [--dry-run]");
    process.exit(1);
  }

  let csvDir: string;
  let tempDir: string | null = null;

  if (values.zip) {
    const zipPath = values.zip.replace(/^~/, process.env.HOME || '~');
    if (!fs.existsSync(zipPath)) { console.error(`Zip file not found: ${zipPath}`); process.exit(1); }
    tempDir = `/tmp/spoti_bye_sync_${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });
    execSync(`unzip -o "${zipPath}" -d "${tempDir}"`, { stdio: 'pipe' });
    csvDir = tempDir;
  } else {
    csvDir = values.dir!;
  }

  const csvFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.csv')).sort();
  console.log(`Found ${csvFiles.length} CSV files in export\n`);

  const existingPlaylists = playlistDb.listPlaylists();
  const existingByName = new Map<string, typeof existingPlaylists[0]>();
  for (const p of existingPlaylists) existingByName.set(p.name, p);

  const stats = {
    newPlaylists: 0, updatedPlaylists: 0, unchangedPlaylists: 0,
    skippedEmpty: 0, newTracks: 0, removedTracks: 0, details: [] as string[],
  };

  const csvPlaylistNames = new Set<string>();

  for (const file of csvFiles) {
    const name = path.basename(file, '.csv').replace(/_/g, ' ');
    csvPlaylistNames.add(name);
    const filePath = path.join(csvDir, file);
    const tracks = parseCsvFull(filePath);

    if (tracks.length === 0) { stats.skippedEmpty++; continue; }

    const existing = existingByName.get(name);

    if (!existing) {
      if (!values["dry-run"]) {
        const playlistId = playlistDb.createPlaylist({ name, source_type: 'spotify' });
        playlistDb.addTracks(playlistId, tracks);
        playlistDb.markSynced(playlistId);
      }
      stats.newPlaylists++;
      stats.newTracks += tracks.length;
      stats.details.push(`+ NEW: "${name}" (${tracks.length} tracks)`);
    } else {
      const existingTracks = playlistDb.getPlaylistTracks(existing.id);
      const existingFp = trackListFingerprint(existingTracks.map(t => ({
        source_track_id: t.source_track_id, title: t.title, artist: t.artist,
      })));
      const newFp = trackListFingerprint(tracks);

      if (existingFp === newFp) {
        if (!values["dry-run"]) playlistDb.markSynced(existing.id);
        stats.unchangedPlaylists++;
      } else {
        const added = tracks.length - existingTracks.length;
        if (!values["dry-run"]) {
          playlistDb.deletePlaylistTracks(existing.id);
          playlistDb.addTracks(existing.id, tracks);
          playlistDb.markSynced(existing.id);
        }
        stats.updatedPlaylists++;
        if (added > 0) stats.newTracks += added;
        if (added < 0) stats.removedTracks += Math.abs(added);
        const changeDesc = added > 0 ? `+${added} tracks` : added < 0 ? `${added} tracks` : 'reordered';
        stats.details.push(`~ UPDATED: "${name}" (${changeDesc}, was ${existingTracks.length} now ${tracks.length})`);
      }
    }
  }

  const missingFromExport: string[] = [];
  for (const [name, playlist] of existingByName) {
    if (!csvPlaylistNames.has(name) && playlist.source_type === 'spotify' && !playlist.youtube_playlist_id) {
      missingFromExport.push(name);
    }
  }

  const dryLabel = values["dry-run"] ? " [DRY RUN]" : "";
  console.log(`=== Spotify Sync Results${dryLabel} ===\n`);
  console.log(`New playlists:       ${stats.newPlaylists}`);
  console.log(`Updated playlists:   ${stats.updatedPlaylists}`);
  console.log(`Unchanged playlists: ${stats.unchangedPlaylists}`);
  console.log(`Skipped (empty):     ${stats.skippedEmpty}`);
  console.log(`New tracks:          ${stats.newTracks}`);
  console.log(`Removed tracks:      ${stats.removedTracks}`);

  if (stats.details.length > 0) {
    console.log(`\nChanges:`);
    for (const d of stats.details) console.log(`  ${d}`);
  }

  if (missingFromExport.length > 0) {
    console.log(`\nNote: ${missingFromExport.length} playlist(s) in DB not found in export:`);
    for (const name of missingFromExport.slice(0, 10)) console.log(`  ? "${name}"`);
    if (missingFromExport.length > 10) console.log(`  ... and ${missingFromExport.length - 10} more`);
  }

  if (tempDir) fs.rmSync(tempDir, { recursive: true });
  playlistDb.closeDb();
}

if (import.meta.main) {
  main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
}
