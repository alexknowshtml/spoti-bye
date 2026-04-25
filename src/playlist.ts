#!/usr/bin/env bun
/**
 * Import, list, and create YouTube playlists.
 *
 * Run via: spoti-bye import|list|create|auth [options]
 *
 * Environment:
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET - OAuth credentials
 *   YOUTUBE_API_KEY - For search (optional, falls back to OAuth)
 *   PLAYLIST_DB_PATH - Override default DB location (~/.spoti-bye/playlists.db)
 */

import { parseArgs } from "util";
import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as db from "./db";

const TOKEN_PATH = path.join(process.env.HOME || "~", ".spoti-bye-youtube-token");

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const API_KEY = process.env.YOUTUBE_API_KEY;

interface Track {
  title: string;
  artist: string;
  videoId?: string;
  durationMs?: number;
}

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

function parseExportifyCsv(filePath: string): Track[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const nameIdx = header.findIndex(h => /track\s*name/i.test(h));
  const artistIdx = header.findIndex(h => /^artist\s*name/i.test(h));
  const durationIdx = header.findIndex(h => /duration\s*\(?ms\)?/i.test(h));

  if (nameIdx === -1 || artistIdx === -1) {
    console.error("CSV missing required columns. Expected 'Track Name' and 'Artist Name(s)'.");
    console.error("Found headers:", header.join(", "));
    process.exit(1);
  }

  const tracks: Track[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length <= nameIdx || cols.length <= artistIdx) continue;
    const title = cols[nameIdx].trim();
    const artist = cols[artistIdx].trim();
    if (!title) continue;

    const track: Track = { title, artist };
    if (durationIdx !== -1 && cols[durationIdx]) {
      const ms = parseInt(cols[durationIdx].trim(), 10);
      if (!isNaN(ms)) track.durationMs = ms;
    }
    tracks.push(track);
  }
  return tracks;
}

interface SearchResult {
  track: Track;
  videoId: string | null;
  videoTitle: string;
  error?: string;
}

function getOAuth2Client() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET environment variables.");
    console.error("See README for setup instructions.");
    process.exit(1);
  }
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "http://localhost:9876/callback");
}

async function authenticate(): Promise<void> {
  const oauth2 = getOAuth2Client();
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/youtube"],
  });

  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(authUrl);
  console.log("\nWaiting for callback on http://localhost:9876/callback ...\n");

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost:9876");
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (!code) { res.writeHead(400); res.end("Missing code parameter"); return; }

        try {
          const { tokens } = await oauth2.getToken(code);
          if (!tokens.refresh_token) {
            res.writeHead(400);
            res.end("No refresh token received. Try revoking app access at https://myaccount.google.com/permissions and retry.");
            return;
          }
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          console.log(`Token saved to ${TOKEN_PATH}`);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Authorized!</h1><p>You can close this tab. Return to terminal.</p>");
        } catch (err: any) {
          res.writeHead(500); res.end(`Error: ${err.message}`);
        }
        server.close();
        resolve();
      }
    });
    server.listen(9876);
  });
}

function getAuthenticatedClient() {
  const oauth2 = getOAuth2Client();
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error("No token found. Run `spoti-bye auth` first to authorize with YouTube.");
    process.exit(1);
  }
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oauth2.setCredentials(tokens);
  oauth2.on("tokens", (newTokens) => {
    if (newTokens.refresh_token) {
      fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...tokens, ...newTokens }, null, 2));
    }
  });
  return oauth2;
}

async function searchYouTube(youtube: any, track: Track): Promise<SearchResult> {
  const query = `${track.artist} - ${track.title} official`;
  try {
    const res = await youtube.search.list({
      part: ["snippet"],
      q: query,
      type: ["video"],
      maxResults: 1,
      videoCategoryId: "10",
    });
    const items = res.data.items || [];
    if (items.length === 0) {
      const retry = await youtube.search.list({
        part: ["snippet"],
        q: `${track.artist} ${track.title}`,
        type: ["video"],
        maxResults: 1,
      });
      const retryItems = retry.data.items || [];
      if (retryItems.length === 0) return { track, videoId: null, videoTitle: "", error: "No results found" };
      return { track, videoId: retryItems[0].id.videoId, videoTitle: retryItems[0].snippet.title };
    }
    return { track, videoId: items[0].id.videoId, videoTitle: items[0].snippet.title };
  } catch (err: any) {
    return { track, videoId: null, videoTitle: "", error: err.message };
  }
}

async function createYouTubePlaylist(youtube: any, name: string, description: string): Promise<string> {
  const res = await youtube.playlists.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title: name, description },
      status: { privacyStatus: "public" },
    },
  });
  return res.data.id;
}

async function addToPlaylist(youtube: any, playlistId: string, videoId: string): Promise<void> {
  await youtube.playlistItems.insert({
    part: ["snippet"],
    requestBody: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } },
  });
}

export async function main() {
  const { values } = parseArgs({
    options: {
      auth: { type: "boolean", default: false },
      name: { type: "string" },
      description: { type: "string", default: "" },
      tracks: { type: "string" },
      track: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      save: { type: "boolean", default: false },
      "from-db": { type: "string" },
      import: { type: "boolean", default: false },
      "source-url": { type: "string" },
      "source-type": { type: "string" },
      "youtube-playlist-id": { type: "string" },
      "youtube-channel-id": { type: "string" },
      "from-csv": { type: "string" },
      list: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.auth) {
    await authenticate();
    return;
  }

  if (values.list) {
    const playlists = db.listPlaylists();
    if (playlists.length === 0) { console.log("No playlists in database."); return; }
    for (const p of playlists) {
      const tracks = db.getPlaylistTracks(p.id);
      console.log(`[${p.id}] ${p.name} (${tracks.length} tracks)`);
      if (p.source_url) console.log(`    Source: ${p.source_url}`);
      if (p.youtube_playlist_url) console.log(`    YouTube: ${p.youtube_playlist_url}`);
      console.log(`    Created: ${p.created_at}`);
      console.log(`    Last synced: ${p.last_synced_at || 'never'}`);
    }
    db.closeDb();
    return;
  }

  if (values.import) {
    if (!values.name) { console.error("--name is required for import"); process.exit(1); }

    let tracks: Track[] = [];
    if (values["from-csv"]) {
      tracks = parseExportifyCsv(values["from-csv"]);
      console.log(`Parsed ${tracks.length} tracks from Exportify CSV`);
    } else if (values.tracks) {
      tracks = JSON.parse(fs.readFileSync(values.tracks, "utf-8"));
    }
    if (values.track) {
      for (const t of values.track) {
        const parts = t.split(" - ");
        tracks.push(parts.length >= 2
          ? { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() }
          : { artist: "", title: t.trim() });
      }
    }
    if (tracks.length === 0) { console.error("No tracks to import."); process.exit(1); }

    const playlistId = db.createPlaylist({
      name: values.name,
      description: values.description || '',
      source_url: values["source-url"],
      source_type: values["source-type"],
      youtube_playlist_id: values["youtube-playlist-id"],
      youtube_playlist_url: values["youtube-playlist-id"]
        ? `https://www.youtube.com/playlist?list=${values["youtube-playlist-id"]}` : undefined,
      youtube_channel_id: values["youtube-channel-id"],
    });

    db.addTracks(playlistId, tracks.map((t, i) => ({
      position: i + 1, title: t.title, artist: t.artist,
      youtube_video_id: t.videoId, duration_ms: t.durationMs,
    })));

    console.log(`Imported ${tracks.length} tracks into playlist [${playlistId}] "${values.name}"`);
    db.closeDb();
    return;
  }

  if (!values.name) { console.error("--name is required"); process.exit(1); }

  let tracks: Track[] = [];
  let dbPlaylistId: number | null = null;

  if (values["from-db"]) {
    dbPlaylistId = parseInt(values["from-db"], 10);
    const playlist = db.getPlaylist(dbPlaylistId);
    if (!playlist) { console.error(`Playlist ${dbPlaylistId} not found in database.`); process.exit(1); }
    const dbTracks = db.getPlaylistTracks(dbPlaylistId);
    tracks = dbTracks.map(t => ({
      title: t.title, artist: t.artist,
      videoId: (t.youtube_video_id && t.youtube_video_id !== 'UNAVAILABLE') ? t.youtube_video_id : undefined,
    }));
    console.log(`Loaded ${tracks.length} tracks from DB playlist [${dbPlaylistId}] "${playlist.name}"`);
  } else if (values["from-csv"]) {
    tracks = parseExportifyCsv(values["from-csv"]);
    console.log(`Parsed ${tracks.length} tracks from Exportify CSV`);
  } else {
    if (values.tracks) tracks = JSON.parse(fs.readFileSync(values.tracks, "utf-8"));
    if (values.track) {
      for (const t of values.track) {
        const parts = t.split(" - ");
        tracks.push(parts.length >= 2
          ? { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() }
          : { artist: "", title: t.trim() });
      }
    }
  }

  if (tracks.length === 0) {
    console.error("No tracks provided. Use --tracks=file.json, --track='Artist - Song', or --from-db=<id>");
    process.exit(1);
  }

  console.log(`Loaded ${tracks.length} tracks`);

  const auth = getAuthenticatedClient();
  const youtubeWrite = google.youtube({ version: "v3", auth });
  const youtubeSearch = API_KEY
    ? google.youtube({ version: "v3", auth: API_KEY })
    : (console.log("Using OAuth for search (shared quota pool)"), youtubeWrite);
  if (API_KEY) console.log("Using API key for search (separate quota pool)");

  console.log("\nResolving YouTube videos...\n");
  const results: SearchResult[] = [];
  const failed: SearchResult[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const label = `[${i + 1}/${tracks.length}]`;
    if (track.videoId) {
      results.push({ track, videoId: track.videoId, videoTitle: "(cached)" });
      console.log(`${label} ⚡ ${track.artist} - ${track.title} (cached: ${track.videoId})`);
      continue;
    }
    const result = await searchYouTube(youtubeSearch, track);
    results.push(result);
    if (result.videoId) console.log(`${label} ✓ ${track.artist} - ${track.title} → ${result.videoTitle}`);
    else { console.log(`${label} ✗ ${track.artist} - ${track.title} (${result.error})`); failed.push(result); }
    await new Promise(r => setTimeout(r, 200));
  }

  const found = results.filter(r => r.videoId);
  console.log(`\nFound ${found.length}/${tracks.length} tracks`);
  if (failed.length > 0) { console.log("\nMissing tracks:"); for (const f of failed) console.log(`  - ${f.track.artist} - ${f.track.title}`); }

  if (values["dry-run"]) { console.log("\n[Dry run] Would create playlist and add videos."); return; }
  if (found.length === 0) { console.error("No videos found. Nothing to create."); process.exit(1); }

  console.log(`\nCreating playlist: "${values.name}"...`);
  const playlistId = await createYouTubePlaylist(youtubeWrite, values.name!, values.description || "");
  const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
  console.log(`Created: ${playlistUrl}`);

  console.log(`\nAdding ${found.length} videos...`);
  let added = 0;
  for (const result of found) {
    try {
      await addToPlaylist(youtubeWrite, playlistId, result.videoId!);
      added++;
      process.stdout.write(`\r  Added ${added}/${found.length}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      console.log(`\n  Failed to add: ${result.track.artist} - ${result.track.title}: ${err.message}`);
    }
  }

  console.log(`\n\nDone! Playlist: ${playlistUrl}`);
  console.log(`${added} of ${tracks.length} tracks added.`);

  if (values.save) {
    if (dbPlaylistId) {
      db.updateYouTubeInfo(dbPlaylistId, { youtube_playlist_id: playlistId, youtube_playlist_url: playlistUrl });
      const dbTracks = db.getPlaylistTracks(dbPlaylistId);
      for (const result of found) {
        const dbTrack = dbTracks.find(t => t.title === result.track.title && t.artist === result.track.artist);
        if (dbTrack && result.videoId && !dbTrack.youtube_video_id) db.updateSongVideoId(dbTrack.song_id, result.videoId);
      }
      console.log(`Updated DB playlist [${dbPlaylistId}] with YouTube info.`);
    } else {
      const newDbId = db.createPlaylist({
        name: values.name!, description: values.description || '',
        source_url: values["source-url"], source_type: values["source-type"],
        youtube_playlist_id: playlistId, youtube_playlist_url: playlistUrl,
      });
      db.addTracks(newDbId, found.map((r, i) => ({
        position: i + 1, title: r.track.title, artist: r.track.artist, youtube_video_id: r.videoId || undefined,
      })));
      console.log(`Saved to DB as playlist [${newDbId}].`);
    }
    db.closeDb();
  }

  if (values.json) console.log(JSON.stringify({ playlistId, playlistUrl, added, total: tracks.length, results }, null, 2));
}

if (import.meta.main) {
  main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
}
