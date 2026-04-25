#!/usr/bin/env bun
/**
 * Resolve YouTube video IDs for songs in the playlist database.
 *
 * Uses yt-dlp's ytsearch to find matching YouTube videos (no API key needed),
 * scores candidates on channel quality, duration match, title similarity,
 * and negative keywords. High-confidence matches are written to the DB
 * automatically; low-confidence matches are saved to a review file.
 *
 * Usage: spoti-bye resolve --playlist=<id> [options]
 *
 * Options:
 *   --playlist=ID       Resolve songs for this playlist (required)
 *   --threshold=N       Min score to auto-accept (default: 5)
 *   --delay=MS          Delay between searches in ms (default: 1500)
 *   --dry-run           Preview matches without writing to DB
 *   --verbose           Show scoring details for each candidate
 */

import * as playlistDb from './db';
import { dirname } from 'node:path';

const CANDIDATES_PER_SEARCH = 5;

const NEGATIVE_KEYWORDS = [
  'cover', 'remix', 'live', 'karaoke', 'acoustic', 'sped up',
  'slowed', 'reverb', 'bass boosted', '8d audio', 'nightcore',
  '1 hour', 'loop', 'lyrics video',
];

interface SearchResult {
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  viewCount: number;
}

interface ScoredResult {
  result: SearchResult;
  score: number;
  reasons: string[];
  skipped: boolean;
  skipReason?: string;
}

interface ResolveResult {
  songId: number;
  artist: string;
  title: string;
  status: 'resolved' | 'flagged' | 'no-results' | 'error';
  videoId?: string;
  score?: number;
  reasons?: string[];
  error?: string;
}

function scoreCandidate(
  candidate: SearchResult,
  spotifyTitle: string,
  spotifyArtist: string,
  durationMs: number | null,
): ScoredResult {
  let score = 0;
  const reasons: string[] = [];
  const ytTitle = candidate.title.toLowerCase();
  const spTitle = spotifyTitle.toLowerCase();
  const spArtist = spotifyArtist.toLowerCase();

  for (const keyword of NEGATIVE_KEYWORDS) {
    if (ytTitle.includes(keyword) && !spTitle.includes(keyword)) {
      return { result: candidate, score: 0, reasons: [], skipped: true, skipReason: `negative keyword: "${keyword}"` };
    }
  }

  const author = candidate.author.toLowerCase();
  if (author.includes('vevo')) {
    score += 3; reasons.push('VEVO channel (+3)');
  } else if (author.includes('- topic') || author.endsWith(' topic')) {
    score += 2; reasons.push('Topic channel (+2)');
  } else {
    const primaryArtist = spArtist.split(/[,;&]/)[0].trim();
    if (author.includes(primaryArtist)) { score += 2; reasons.push('artist channel (+2)'); }
  }

  if (durationMs != null && candidate.lengthSeconds > 0) {
    const spotifySec = durationMs / 1000;
    const diff = Math.abs(spotifySec - candidate.lengthSeconds);
    if (diff <= 5)       { score += 3; reasons.push(`duration ±${diff.toFixed(0)}s (+3)`); }
    else if (diff <= 15) { score += 2; reasons.push(`duration ±${diff.toFixed(0)}s (+2)`); }
    else if (diff <= 30) { score += 1; reasons.push(`duration ±${diff.toFixed(0)}s (+1)`); }
    else if (diff > 60)  { return { result: candidate, score: 0, reasons: [], skipped: true, skipReason: `duration off by ${diff.toFixed(0)}s` }; }
    else                 { score -= 2; reasons.push(`duration ±${diff.toFixed(0)}s (-2)`); }
  }

  const primaryArtist = spArtist.split(/[,;&]/)[0].trim();
  const hasArtist = ytTitle.includes(primaryArtist);
  const hasTitle = ytTitle.includes(spTitle);
  if (hasArtist && hasTitle) { score += 2; reasons.push('artist+title match (+2)'); }
  else if (hasTitle)         { score += 1; reasons.push('title match only (+1)'); }
  else                       { score -= 1; reasons.push('weak title match (-1)'); }

  if (candidate.viewCount > 1_000_000) {
    score += 1; reasons.push(`${(candidate.viewCount / 1_000_000).toFixed(1)}M views (+1)`);
  }

  return { result: candidate, score, reasons, skipped: false };
}

async function searchYouTube(query: string): Promise<SearchResult[]> {
  const searchQuery = `ytsearch${CANDIDATES_PER_SEARCH}:${query}`;
  try {
    const proc = Bun.spawn(
      ['yt-dlp', searchQuery, '--dump-json', '--flat-playlist', '--no-warnings'],
      { stdout: 'pipe', stderr: 'pipe', timeout: 30_000 },
    );
    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0 && !output.trim()) {
      console.error(`  yt-dlp error: ${stderr.trim().slice(0, 100)}`);
      return [];
    }

    const results: SearchResult[] = [];
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      try {
        const d = JSON.parse(line);
        results.push({
          videoId: d.id, title: d.title || '',
          author: d.channel || d.uploader || '',
          lengthSeconds: d.duration || 0, viewCount: d.view_count || 0,
        });
      } catch {}
    }
    return results;
  } catch (err: any) {
    console.error(`  yt-dlp failed: ${err.message || err}`);
    return [];
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const m = arg.match(/^--(\w[\w-]*)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? 'true';
  }

  const playlistId = parseInt(flags['playlist'] || '');
  if (!playlistId) {
    console.error('Usage: spoti-bye resolve --playlist=<id> [--threshold=5] [--delay=1500] [--dry-run] [--verbose]');
    process.exit(1);
  }

  const threshold = parseInt(flags['threshold'] || '5');
  const delay = parseInt(flags['delay'] || '1500');
  const dryRun = flags['dry-run'] === 'true';
  const verbose = flags['verbose'] === 'true';

  const playlist = playlistDb.getPlaylist(playlistId);
  if (!playlist) { console.error(`Playlist ${playlistId} not found`); process.exit(1); }

  const tracks = playlistDb.getPlaylistTracks(playlistId);
  const unresolved = tracks.filter(t => !t.youtube_video_id);

  console.log(`Playlist: ${playlist.name} (${tracks.length} tracks, ${unresolved.length} unresolved)`);
  if (dryRun) console.log('[DRY RUN — no DB writes]');
  console.log(`Threshold: ${threshold}, Delay: ${delay}ms\n`);

  if (unresolved.length === 0) {
    console.log('All tracks already have YouTube IDs.');
    playlistDb.closeDb();
    return;
  }

  const results: ResolveResult[] = [];
  const reviewItems: ResolveResult[] = [];

  for (let i = 0; i < unresolved.length; i++) {
    const track = unresolved[i];
    const progress = `[${i + 1}/${unresolved.length}]`;
    const query = `${track.artist} ${track.title}`;

    process.stdout.write(`${progress} ${track.artist} - ${track.title}`);

    const candidates = await searchYouTube(query);

    if (candidates.length === 0) {
      console.log(' → no results');
      results.push({ songId: track.song_id, artist: track.artist, title: track.title, status: 'no-results' });
      if (i < unresolved.length - 1) await Bun.sleep(delay);
      continue;
    }

    const scored = candidates.map(c => scoreCandidate(c, track.title, track.artist, track.duration_ms));

    if (verbose) {
      console.log('');
      for (const s of scored) {
        const prefix = s.skipped ? '  ✗' : '  ·';
        const info = s.skipped ? `SKIP: ${s.skipReason}` : `score=${s.score} [${s.reasons.join(', ')}]`;
        console.log(`${prefix} "${s.result.title}" by ${s.result.author} — ${info}`);
      }
    }

    const viable = scored.filter(s => !s.skipped).sort((a, b) => b.score - a.score);
    const best = viable[0];

    if (!best || best.score < threshold) {
      const flagScore = best ? best.score : 0;
      const label = best ? `score ${flagScore} < ${threshold}` : 'all candidates skipped';
      if (!verbose) console.log(` → flagged (${label})`);
      else console.log(`  → flagged (${label})`);

      const result: ResolveResult = {
        songId: track.song_id, artist: track.artist, title: track.title,
        status: 'flagged', score: flagScore, reasons: best?.reasons, videoId: best?.result.videoId,
      };
      results.push(result);
      reviewItems.push(result);
    } else {
      if (!verbose) console.log(` → ${best.result.videoId} (score ${best.score})`);
      else console.log(`  → MATCH: ${best.result.videoId} (score ${best.score})`);

      if (!dryRun) playlistDb.updateSongVideoId(track.song_id, best.result.videoId);

      results.push({
        songId: track.song_id, artist: track.artist, title: track.title,
        status: 'resolved', videoId: best.result.videoId, score: best.score, reasons: best.reasons,
      });
    }

    if (i < unresolved.length - 1) await Bun.sleep(delay);
  }

  const resolved = results.filter(r => r.status === 'resolved');
  const flagged = results.filter(r => r.status === 'flagged');
  const noResults = results.filter(r => r.status === 'no-results');

  console.log(`\n=== Results${dryRun ? ' [DRY RUN]' : ''} ===\n`);
  console.log(`Resolved:   ${resolved.length}`);
  console.log(`Flagged:    ${flagged.length}`);
  console.log(`No results: ${noResults.length}`);
  console.log(`Total:      ${results.length}`);

  if (reviewItems.length > 0) {
    const dbDir = dirname(playlistDb.DB_PATH);
    const reviewPath = `${dbDir}/youtube-review-${playlistId}.json`;
    const reviewData = reviewItems.map(r => ({
      song_id: r.songId,
      artist: r.artist,
      title: r.title,
      best_candidate_video_id: r.videoId || null,
      best_candidate_score: r.score || 0,
      scoring_notes: r.reasons || [],
      youtube_url: r.videoId ? `https://youtube.com/watch?v=${r.videoId}` : null,
    }));

    if (!dryRun) {
      await Bun.write(reviewPath, JSON.stringify(reviewData, null, 2));
      console.log(`\nReview file: ${reviewPath}`);
      console.log('Run `spoti-bye review` to process flagged tracks.');
    } else {
      console.log('\nFlagged for review:');
      for (const r of reviewItems) {
        const ytUrl = r.videoId ? `https://youtube.com/watch?v=${r.videoId}` : 'none';
        console.log(`  ${r.artist} - ${r.title} (score: ${r.score}, best: ${ytUrl})`);
      }
    }
  }

  playlistDb.closeDb();
}

if (import.meta.main) {
  main().catch(err => { console.error('Fatal error:', err); playlistDb.closeDb(); process.exit(1); });
}
