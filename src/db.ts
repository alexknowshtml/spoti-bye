/**
 * SQLite database for storing playlists and songs.
 *
 * Default DB location: ~/.spoti-bye/playlists.db
 * Override with PLAYLIST_DB_PATH env var.
 *
 * Normalized schema:
 *   - playlists: playlist metadata (source URLs, YouTube IDs)
 *   - songs: unique songs keyed by source_track_id (Spotify URI), with metadata + audio features
 *   - playlist_tracks: join table linking playlists to songs
 *
 * Uses bun:sqlite (Bun's built-in SQLite driver).
 */

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

export const DEFAULT_DB_DIR = join(homedir(), '.spoti-bye');
export const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'playlists.db');
export const DB_PATH = process.env.PLAYLIST_DB_PATH || DEFAULT_DB_PATH;

let db: Database | null = null;

export interface PlaylistRow {
  id: number;
  name: string;
  description: string;
  source_url: string | null;
  source_type: string | null;
  youtube_playlist_id: string | null;
  youtube_playlist_url: string | null;
  youtube_channel_id: string | null;
  created_at: string;
  updated_at: string | null;
  last_synced_at: string | null;
}

export interface SongRow {
  id: number;
  source_track_id: string | null;
  title: string;
  artist: string;
  album_name: string | null;
  release_date: string | null;
  duration_ms: number | null;
  popularity: number | null;
  explicit: number | null;
  genres: string | null;
  record_label: string | null;
  danceability: number | null;
  energy: number | null;
  key: number | null;
  loudness: number | null;
  mode: number | null;
  speechiness: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  liveness: number | null;
  valence: number | null;
  tempo: number | null;
  time_signature: number | null;
  youtube_video_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TrackRow {
  id: number;
  song_id: number;
  playlist_id: number;
  position: number;
  title: string;
  artist: string;
  album_name: string | null;
  release_date: string | null;
  youtube_video_id: string | null;
  source_track_id: string | null;
  duration_ms: number | null;
  popularity: number | null;
  explicit: number | null;
  genres: string | null;
  record_label: string | null;
  danceability: number | null;
  energy: number | null;
  key: number | null;
  loudness: number | null;
  mode: number | null;
  speechiness: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  liveness: number | null;
  valence: number | null;
  tempo: number | null;
  time_signature: number | null;
  spotify_added_by: string | null;
  spotify_added_at: string | null;
  added_at: string;
}

export interface TrackInsert {
  position: number;
  title: string;
  artist: string;
  album_name?: string;
  release_date?: string;
  youtube_video_id?: string;
  source_track_id?: string;
  duration_ms?: number;
  popularity?: number;
  explicit?: number;
  genres?: string;
  record_label?: string;
  danceability?: number;
  energy?: number;
  key?: number;
  loudness?: number;
  mode?: number;
  speechiness?: number;
  acousticness?: number;
  instrumentalness?: number;
  liveness?: number;
  valence?: number;
  tempo?: number;
  time_signature?: number;
  spotify_added_by?: string;
  spotify_added_at?: string;
}

export function getDb(): Database {
  if (db) return db;

  mkdirSync(DB_PATH === DEFAULT_DB_PATH ? DEFAULT_DB_DIR : require('node:path').dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      source_url TEXT,
      source_type TEXT,
      youtube_playlist_id TEXT,
      youtube_playlist_url TEXT,
      youtube_channel_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_track_id TEXT UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album_name TEXT,
      release_date TEXT,
      duration_ms INTEGER,
      popularity INTEGER,
      explicit INTEGER,
      genres TEXT,
      record_label TEXT,
      danceability REAL,
      energy REAL,
      key INTEGER,
      loudness REAL,
      mode INTEGER,
      speechiness REAL,
      acousticness REAL,
      instrumentalness REAL,
      liveness REAL,
      valence REAL,
      tempo REAL,
      time_signature INTEGER,
      youtube_video_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_songs_source_track_id ON songs(source_track_id);
    CREATE INDEX IF NOT EXISTS idx_songs_artist_title ON songs(artist, title);

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      song_id INTEGER NOT NULL REFERENCES songs(id),
      position INTEGER NOT NULL,
      spotify_added_by TEXT,
      spotify_added_at TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(playlist_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_song ON playlist_tracks(song_id);
  `);

  return db;
}

const SONG_UPSERT_SQL = `
  INSERT INTO songs (
    source_track_id, title, artist, album_name, release_date,
    duration_ms, popularity, explicit, genres, record_label,
    danceability, energy, key, loudness, mode, speechiness, acousticness,
    instrumentalness, liveness, valence, tempo, time_signature,
    youtube_video_id
  ) VALUES (
    $source_track_id, $title, $artist, $album_name, $release_date,
    $duration_ms, $popularity, $explicit, $genres, $record_label,
    $danceability, $energy, $key, $loudness, $mode, $speechiness, $acousticness,
    $instrumentalness, $liveness, $valence, $tempo, $time_signature,
    $youtube_video_id
  )
  ON CONFLICT(source_track_id) DO UPDATE SET
    title = excluded.title,
    artist = excluded.artist,
    album_name = COALESCE(excluded.album_name, songs.album_name),
    release_date = COALESCE(excluded.release_date, songs.release_date),
    duration_ms = COALESCE(excluded.duration_ms, songs.duration_ms),
    popularity = COALESCE(excluded.popularity, songs.popularity),
    explicit = COALESCE(excluded.explicit, songs.explicit),
    genres = COALESCE(excluded.genres, songs.genres),
    record_label = COALESCE(excluded.record_label, songs.record_label),
    danceability = COALESCE(excluded.danceability, songs.danceability),
    energy = COALESCE(excluded.energy, songs.energy),
    key = COALESCE(excluded.key, songs.key),
    loudness = COALESCE(excluded.loudness, songs.loudness),
    mode = COALESCE(excluded.mode, songs.mode),
    speechiness = COALESCE(excluded.speechiness, songs.speechiness),
    acousticness = COALESCE(excluded.acousticness, songs.acousticness),
    instrumentalness = COALESCE(excluded.instrumentalness, songs.instrumentalness),
    liveness = COALESCE(excluded.liveness, songs.liveness),
    valence = COALESCE(excluded.valence, songs.valence),
    tempo = COALESCE(excluded.tempo, songs.tempo),
    time_signature = COALESCE(excluded.time_signature, songs.time_signature),
    youtube_video_id = COALESCE(songs.youtube_video_id, excluded.youtube_video_id),
    updated_at = datetime('now')`;

function songParams(track: TrackInsert) {
  return {
    $source_track_id: track.source_track_id || null,
    $title: track.title,
    $artist: track.artist,
    $album_name: track.album_name || null,
    $release_date: track.release_date || null,
    $duration_ms: track.duration_ms ?? null,
    $popularity: track.popularity ?? null,
    $explicit: track.explicit ?? null,
    $genres: track.genres || null,
    $record_label: track.record_label || null,
    $danceability: track.danceability ?? null,
    $energy: track.energy ?? null,
    $key: track.key ?? null,
    $loudness: track.loudness ?? null,
    $mode: track.mode ?? null,
    $speechiness: track.speechiness ?? null,
    $acousticness: track.acousticness ?? null,
    $instrumentalness: track.instrumentalness ?? null,
    $liveness: track.liveness ?? null,
    $valence: track.valence ?? null,
    $tempo: track.tempo ?? null,
    $time_signature: track.time_signature ?? null,
    $youtube_video_id: track.youtube_video_id || null,
  };
}

export function upsertSong(track: TrackInsert): number {
  const db = getDb();

  if (track.source_track_id) {
    db.prepare(SONG_UPSERT_SQL).run(songParams(track));
    const row = db.prepare('SELECT id FROM songs WHERE source_track_id = ?').get(track.source_track_id) as { id: number };
    return row.id;
  }

  const existing = db.prepare(
    'SELECT id FROM songs WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?) LIMIT 1'
  ).get(track.artist, track.title) as { id: number } | undefined;

  if (existing) {
    if (track.youtube_video_id) {
      db.prepare(
        "UPDATE songs SET youtube_video_id = COALESCE(youtube_video_id, ?), updated_at = datetime('now') WHERE id = ?"
      ).run(track.youtube_video_id, existing.id);
    }
    return existing.id;
  }

  db.prepare(`
    INSERT INTO songs (
      title, artist, album_name, release_date, duration_ms, popularity, explicit,
      genres, record_label, danceability, energy, key, loudness, mode, speechiness,
      acousticness, instrumentalness, liveness, valence, tempo, time_signature,
      youtube_video_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    track.title, track.artist,
    track.album_name || null, track.release_date || null,
    track.duration_ms ?? null, track.popularity ?? null, track.explicit ?? null,
    track.genres || null, track.record_label || null,
    track.danceability ?? null, track.energy ?? null, track.key ?? null,
    track.loudness ?? null, track.mode ?? null, track.speechiness ?? null,
    track.acousticness ?? null, track.instrumentalness ?? null,
    track.liveness ?? null, track.valence ?? null, track.tempo ?? null,
    track.time_signature ?? null, track.youtube_video_id || null,
  );
  const row = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
  return row.id;
}

export function createPlaylist(playlist: {
  name: string;
  description?: string;
  source_url?: string;
  source_type?: string;
  youtube_playlist_id?: string;
  youtube_playlist_url?: string;
  youtube_channel_id?: string;
}): number {
  const db = getDb();
  db.prepare(`
    INSERT INTO playlists (name, description, source_url, source_type,
      youtube_playlist_id, youtube_playlist_url, youtube_channel_id)
    VALUES ($name, $description, $source_url, $source_type,
      $youtube_playlist_id, $youtube_playlist_url, $youtube_channel_id)
  `).run({
    $name: playlist.name,
    $description: playlist.description || '',
    $source_url: playlist.source_url || null,
    $source_type: playlist.source_type || null,
    $youtube_playlist_id: playlist.youtube_playlist_id || null,
    $youtube_playlist_url: playlist.youtube_playlist_url || null,
    $youtube_channel_id: playlist.youtube_channel_id || null,
  });

  const row = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
  return row.id;
}

export function addTrack(track: TrackInsert & { playlist_id: number }): number {
  const db = getDb();
  const songId = upsertSong(track);
  db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, song_id, position, spotify_added_by, spotify_added_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(track.playlist_id, songId, track.position, track.spotify_added_by || null, track.spotify_added_at || null);
  const row = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
  return row.id;
}

export function addTracks(playlistId: number, tracks: TrackInsert[]): number {
  const db = getDb();

  const insertMany = db.transaction((items: TrackInsert[]) => {
    let count = 0;
    const songUpsertStmt = db.prepare(SONG_UPSERT_SQL);
    const findByUri = db.prepare('SELECT id FROM songs WHERE source_track_id = ?');
    const findByName = db.prepare('SELECT id FROM songs WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?) LIMIT 1');
    const insertPt = db.prepare(`
      INSERT INTO playlist_tracks (playlist_id, song_id, position, spotify_added_by, spotify_added_at)
      VALUES ($playlist_id, $song_id, $position, $spotify_added_by, $spotify_added_at)
    `);
    const getLastId = db.prepare('SELECT last_insert_rowid() as id');
    const insertSongNoUri = db.prepare(`
      INSERT INTO songs (
        title, artist, album_name, release_date, duration_ms, popularity, explicit,
        genres, record_label, danceability, energy, key, loudness, mode, speechiness,
        acousticness, instrumentalness, liveness, valence, tempo, time_signature,
        youtube_video_id
      ) VALUES ($title, $artist, $album_name, $release_date, $duration_ms, $popularity, $explicit,
        $genres, $record_label, $danceability, $energy, $key, $loudness, $mode, $speechiness,
        $acousticness, $instrumentalness, $liveness, $valence, $tempo, $time_signature,
        $youtube_video_id)
    `);
    const updateYtIfNull = db.prepare(
      "UPDATE songs SET youtube_video_id = COALESCE(youtube_video_id, ?), updated_at = datetime('now') WHERE id = ?"
    );

    for (const track of items) {
      let songId: number;

      if (track.source_track_id) {
        songUpsertStmt.run(songParams(track));
        songId = (findByUri.get(track.source_track_id) as { id: number }).id;
      } else {
        const existing = findByName.get(track.artist, track.title) as { id: number } | undefined;
        if (existing) {
          songId = existing.id;
          if (track.youtube_video_id) {
            updateYtIfNull.run(track.youtube_video_id, existing.id);
          }
        } else {
          insertSongNoUri.run({
            $title: track.title,
            $artist: track.artist,
            $album_name: track.album_name || null,
            $release_date: track.release_date || null,
            $duration_ms: track.duration_ms ?? null,
            $popularity: track.popularity ?? null,
            $explicit: track.explicit ?? null,
            $genres: track.genres || null,
            $record_label: track.record_label || null,
            $danceability: track.danceability ?? null,
            $energy: track.energy ?? null,
            $key: track.key ?? null,
            $loudness: track.loudness ?? null,
            $mode: track.mode ?? null,
            $speechiness: track.speechiness ?? null,
            $acousticness: track.acousticness ?? null,
            $instrumentalness: track.instrumentalness ?? null,
            $liveness: track.liveness ?? null,
            $valence: track.valence ?? null,
            $tempo: track.tempo ?? null,
            $time_signature: track.time_signature ?? null,
            $youtube_video_id: track.youtube_video_id || null,
          });
          songId = (getLastId.get() as { id: number }).id;
        }
      }

      insertPt.run({
        $playlist_id: playlistId,
        $song_id: songId,
        $position: track.position,
        $spotify_added_by: track.spotify_added_by || null,
        $spotify_added_at: track.spotify_added_at || null,
      });
      count++;
    }
    return count;
  });

  return insertMany(tracks);
}

export function getPlaylist(id: number): PlaylistRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined;
}

export function getPlaylistTracks(playlistId: number): TrackRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      pt.id, pt.song_id, pt.playlist_id, pt.position,
      pt.spotify_added_by, pt.spotify_added_at, pt.added_at,
      s.title, s.artist, s.album_name, s.release_date,
      s.youtube_video_id, s.source_track_id, s.duration_ms,
      s.popularity, s.explicit, s.genres, s.record_label,
      s.danceability, s.energy, s.key, s.loudness, s.mode,
      s.speechiness, s.acousticness, s.instrumentalness,
      s.liveness, s.valence, s.tempo, s.time_signature
    FROM playlist_tracks pt
    JOIN songs s ON pt.song_id = s.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `).all(playlistId) as TrackRow[];
}

export function deletePlaylistTracks(playlistId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
}

export function updateYouTubeInfo(playlistId: number, info: {
  youtube_playlist_id: string;
  youtube_playlist_url: string;
  youtube_channel_id?: string;
}): void {
  const db = getDb();
  db.prepare(`
    UPDATE playlists SET
      youtube_playlist_id = $youtube_playlist_id,
      youtube_playlist_url = $youtube_playlist_url,
      youtube_channel_id = COALESCE($youtube_channel_id, youtube_channel_id),
      updated_at = datetime('now')
    WHERE id = $id
  `).run({
    $id: playlistId,
    $youtube_playlist_id: info.youtube_playlist_id,
    $youtube_playlist_url: info.youtube_playlist_url,
    $youtube_channel_id: info.youtube_channel_id || null,
  });
}

export function updateSongVideoId(songId: number, videoId: string): void {
  const db = getDb();
  db.prepare("UPDATE songs SET youtube_video_id = ?, updated_at = datetime('now') WHERE id = ?").run(videoId, songId);
}

export function getSong(songId: number): SongRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as SongRow | undefined;
}

export function findSongByTrackId(sourceTrackId: string): SongRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM songs WHERE source_track_id = ?').get(sourceTrackId) as SongRow | undefined;
}

export function findSongsByArtistTitle(artist: string, title: string): SongRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM songs WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?)'
  ).all(artist, title) as SongRow[];
}

export function listPlaylists(): PlaylistRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all() as PlaylistRow[];
}

export function markSynced(playlistId: number): void {
  const db = getDb();
  db.prepare("UPDATE playlists SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(playlistId);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
