export const artist = "Behnoosh";

export type Album = {
  id: string;
  title: string;
  year: string;
  cover: string;
  variant: number;
};

export type Track = {
  id: string;
  title: string;
  albumId: string;
  duration: number;
};

export type Video = {
  id: string;
  title: string;
  meta: string;
  image: string;
  trackId: string;
};

export type Stop = {
  id: string;
  city: string;
  country: string;
  date: string;
};

export type Post = {
  id: string;
  title: string;
  body: string;
  image: string;
};

export const albums: Album[] = [
  { id: "voltage", title: "Voltage", year: "2026", cover: "/art/album-voltage.jpg", variant: 0 },
  { id: "glassroom", title: "Glassroom", year: "2025", cover: "/art/album-glass.jpg", variant: 1 },
  { id: "north", title: "North Index", year: "2024", cover: "/art/album-north.jpg", variant: 2 },
  { id: "after", title: "Afterimage", year: "2023", cover: "/art/album-after.jpg", variant: 3 },
];

export const tracks: Track[] = [
  { id: "glass-hour", title: "Glass Hour", albumId: "voltage", duration: 192 },
  { id: "red-circuit", title: "Red Circuit", albumId: "voltage", duration: 164 },
  { id: "low-orbit", title: "Low Orbit", albumId: "voltage", duration: 221 },
  { id: "static-bloom", title: "Static Bloom", albumId: "voltage", duration: 178 },
  { id: "pink-static", title: "Pink Static", albumId: "glassroom", duration: 156 },
  { id: "shearling", title: "Shearling", albumId: "glassroom", duration: 185 },
  { id: "room-tone", title: "Room Tone", albumId: "glassroom", duration: 241 },
  { id: "rooftop", title: "Rooftop", albumId: "north", duration: 171 },
  { id: "blue-hour", title: "Blue Hour", albumId: "north", duration: 198 },
  { id: "signal", title: "Signal", albumId: "north", duration: 147 },
  { id: "ice-record", title: "Ice Record", albumId: "after", duration: 213 },
  { id: "pale-loop", title: "Pale Loop", albumId: "after", duration: 169 },
];

export const videos: Video[] = [
  {
    id: "room-lisbon",
    title: "Room 4 — Lisbon rehearsal",
    meta: "Session visual",
    image: "/art/concert.jpg",
    trackId: "glass-hour",
  },
  {
    id: "north-visual",
    title: "North Index — stage test",
    meta: "Session visual",
    image: "/art/stage.jpg",
    trackId: "rooftop",
  },
  {
    id: "studio",
    title: "Voltage — studio sketch",
    meta: "Session visual",
    image: "/art/portrait.jpg",
    trackId: "red-circuit",
  },
];

export const stops: Stop[] = [
  { id: "lisbon", city: "Lisbon", country: "Portugal", date: "04/11" },
  { id: "marseille", city: "Marseille", country: "France", date: "04/14" },
  { id: "rotterdam", city: "Rotterdam", country: "Netherlands", date: "04/18" },
  { id: "warsaw", city: "Warsaw", country: "Poland", date: "04/21" },
  { id: "oslo", city: "Oslo", country: "Norway", date: "04/25" },
  { id: "helsinki", city: "Helsinki", country: "Finland", date: "05/02" },
  { id: "dublin", city: "Dublin", country: "Ireland", date: "05/06" },
  { id: "montreal", city: "Montreal", country: "Canada", date: "05/12" },
];

export const posts: Post[] = [
  {
    id: "p1",
    title: "Cap came back from the dyer",
    body: "VELA in white, one take, no retouch on the collar. Cover lab is open if you want to wreck it.",
    image: "/art/portrait.jpg",
  },
  {
    id: "p2",
    title: "Lisbon room, no phones",
    body: "We ran Glass Hour twice. The second take is the one on the player.",
    image: "/art/concert.jpg",
  },
  {
    id: "p3",
    title: "Voltage room, 2026",
    body: "Eight cities. Holds stay on this device until you drop them.",
    image: "/art/stage.jpg",
  },
];

export const sessions = videos;

export function albumById(id: string) {
  return albums.find((a) => a.id === id) ?? albums[0];
}

export function trackById(id: string) {
  return tracks.find((t) => t.id === id) ?? tracks[0];
}

export function tracksFor(albumId: string) {
  return tracks.filter((t) => t.albumId === albumId);
}

export function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
