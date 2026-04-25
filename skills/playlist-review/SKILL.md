---
name: playlist-review
description: Interactively review flagged tracks from the YouTube resolver. Edit review JSON files to accept or reject candidates, then run spoti-bye review to apply.
triggers:
  - "review flagged tracks"
  - "review playlists"
  - "process review"
  - "review youtube matches"
---

# playlist-review

Process tracks that the resolver couldn't auto-match.

## When to Use

- After `spoti-bye resolve` runs and flags low-confidence matches
- User wants to manually approve or reject YouTube candidates

## Review File Location

After resolving, flagged tracks land in:
```
~/.spoti-bye/youtube-review-<playlist_id>.json
```

Each entry looks like:
```json
{
  "song_id": 1234,
  "artist": "Artist Name",
  "title": "Song Title",
  "best_candidate_video_id": "dQw4w9WgXcQ",
  "best_candidate_score": 3,
  "scoring_notes": ["VEVO channel (+3)", "duration ±2s (+3)"],
  "youtube_url": "https://youtube.com/watch?v=dQw4w9WgXcQ"
}
```

## How to Review

1. Open the review file
2. For each entry:
   - Check the `youtube_url` to verify the video
   - **Accept**: keep the `best_candidate_video_id` as-is
   - **Different video**: replace `best_candidate_video_id` with the correct ID
   - **Mark unavailable**: set `best_candidate_video_id` to `null`
3. Save the file
4. Run: `spoti-bye review`

The review command applies all decisions and deletes processed files.

## Review Heuristics

- Score 4+ from artist/Topic channel with good duration → usually safe to accept
- Score ≤2 with duration >15s off → manually search for a better match
- No results for indie/local artists → mark null (UNAVAILABLE)
- Podcast episodes (duration >10 min, no artist) → mark null
- Score 3 with title mismatch (remix, remaster) → verify the video before accepting
