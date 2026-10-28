# Melobi product benchmark

Compared with Spotify, Apple Music, YouTube Music, and Radio Javan (the catalog behind Melobi). This is the menu of actions a listener expects. The last section is what Melobi ships from data the backend actually returns.

English UI only. The stage character, themes, glass, and type stay as they are.

## Home

| Action | Spotify | Apple Music | YouTube Music | Radio Javan | Melobi |
|---|---|---|---|---|---|
| Continue / recently played | Yes | Yes | Yes | Yes | Yes, on the mobile home |
| Made-for-you / new releases | Yes | Yes | Yes | Just Released | Trending and new albums |
| Playlists row | Yes | Yes | Yes | Play On | Yes |
| Videos row | — | Music videos | Yes | Yes | Yes, opens the video player |
| Podcasts | Separate app | Yes | Podcasts | Yes | Yes |
| Artists | Yes | Yes | Yes | Trending artists | Yes |
| Search entry | Tab | Tab | Tab | Search | Field on the home, plus a jump chip |
| Like / save from a row | Yes | Yes | Yes | Yes | Heart on rows |
| Show all | Yes | Yes | Yes | Section links | Each home block |

## Search

| Action | Typical apps | Melobi |
|---|---|---|
| Songs, albums, artists, playlists, videos, podcasts | All four | Same groups, from `/api/v1/search` |
| Play a result | Yes | Yes |
| Open album / playlist / video | Yes | Yes |
| Empty and no-match states | Yes | Yes |
| Filters (downloaded, explicit) | Spotify, Apple | No download-library flag in the API |

## Album

| Action | Typical apps | Melobi |
|---|---|---|
| Play album | Yes | Yes |
| Track list, play, like, download | Yes | Yes |
| Share a track | Yes | Yes, Melobi link `/?track=` |
| Add to a playlist | Yes | Yes, from Now Playing |
| Go to artist | Yes | Opens search for that artist name |
| Credits, liner notes | Apple, Spotify | Not in the track payload |

## Artist

| Action | Typical apps | Melobi |
|---|---|---|
| Popular tracks, albums, videos | Yes | No artist-discography endpoint. Search by name is the stand-in |
| Follow | Yes | Save on the artist card. Signed-in follows stay on the account |
| Radio / similar artists | Spotify, YouTube | Not in the payload |

## Playlist

| Action | Typical apps | Melobi |
|---|---|---|
| Catalog playlists | Yes | Radio Javan playlists from home and `/playlists/:id` |
| Your playlists: create, rename, reorder, remove | Spotify, Apple | Yes. On the account when signed in, on this device for a guest |
| Collaborative / public share of a user playlist | Spotify | Each account keeps its own playlists |
| Download whole playlist | Spotify | Per-track download only |

## Videos

| Action | Typical apps | Melobi |
|---|---|---|
| Watch inline with controls | YouTube Music, Radio Javan | Yes. MP4 in a `<video>` element |
| Full screen | Yes | Native video controls |
| HLS when the file is `.m3u8` | Apps use their own player | hls.js when the browser has no native HLS |
| Picture-in-picture | Browsers | Native controls when the browser offers it |
| Pause music while video plays | Expected | Yes, and music pauses the video |
| Audio-only of the linked song | Radio Javan also has the mp3 | Not used as the video tap. The picture plays |

## Podcasts

| Action | Typical apps | Melobi |
|---|---|---|
| Show page and episode play | Yes | Episodes that include audio play as tracks |
| Chapters, sleep while speaking | Apple, Spotify | Sleep timer is on Now Playing for any audio |
| Follow a show | Yes | Open the show. No follow graph in the API |

## Now Playing

| Action | Typical apps | Melobi |
|---|---|---|
| Play, pause, seek, next, previous | Yes | Yes |
| Shuffle, repeat | Yes | Yes |
| Like | Yes | Yes |
| Download | Spotify, Radio Javan | Yes, when `downloadPath` exists |
| Share | Yes | System share sheet, or copy the link |
| Add to playlist | Yes | Yes |
| Up next | Yes | Next tracks in the current album or chart |
| Sleep timer | Spotify, YouTube | Yes, 15 / 30 / 60 minutes |
| Lyrics | Spotify, Apple, YouTube | No lyric field on tracks |
| Go to album / artist | Yes | Yes |
| Playback speed | Podcast apps | Not on songs |
| Queue edit (drag) | Spotify | Order follows the album, chart, or playlist |

## Mini player

| Action | Typical apps | Melobi |
|---|---|---|
| Title, artist, progress | Yes | Yes |
| Play / pause | Yes | Yes |
| Open the full player | Yes | Yes |
| Share | Often in a menu | Share button |

## Library, favorites, history

| Action | Typical apps | Melobi |
|---|---|---|
| Liked songs | Yes | Favorites. The account library when signed in |
| Recently played | Yes | History, newest first, synced with the account |
| Your playlists | Yes | Yes, per account |
| Made-for-you mixes | Spotify | No private listening profile in the API |
| Downloaded library | Spotify, YouTube | Each download is a file save, not an offline library |

## Settings

| Action | Typical apps | Melobi |
|---|---|---|
| Theme | Some | Four themes on the home |
| Audio quality | Spotify, Apple | Stream is the CDN file the API returns. No quality picker |
| Explicit content | Yes | `explicit` exists on tracks; no account gate |
| Account, devices, subscription | All four | Email account: profile, password, sign out, delete. No subscription |
| Equalizer, crossfade | Spotify, Apple | Not in the API |
| Storage / downloads manager | Yes | Not stored as a library |

## What we do not invent

- Lyrics, credits, similar-artist radio, and private mixes: the payload has no text or graph for them.
- A shared public playlist between two people. Each account has its own library.
- Radio Javan `share_link` (`rj.app`) is a different app. Melobi shares `/?track=<id>` so the WebView and the site open the same song.
