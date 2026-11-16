// Default resting places on the desk, as fractions of desk width/height (card centre)
// plus a rotation in degrees. Visitors can move things; their layout is kept locally.
export type Spot = { cx: number; cy: number; r: number };

export const fixedSpots = {
  me: { cx: 0.12, cy: 0.31, r: -4 },
  now: { cx: 0.315, cy: 0.27, r: 2.5 },
  socials: { cx: 0.13, cy: 0.72, r: -2.5 },
} satisfies Record<string, Spot>;

const projectSpots: Spot[] = [
  { cx: 0.555, cy: 0.26, r: -1.8 },
  { cx: 0.805, cy: 0.35, r: 3 },
];

const noteSpots: Spot[] = [
  { cx: 0.365, cy: 0.73, r: 1.6 },
  { cx: 0.605, cy: 0.7, r: -2.4 },
  { cx: 0.845, cy: 0.77, r: 2.2 },
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

// Anything beyond the designed slots lands somewhere stable but random-looking.
function looseSpot(key: string): Spot {
  const a = hash(key), b = hash(key + 'y'), c = hash(key + 'r');
  return { cx: 0.12 + a * 0.76, cy: 0.22 + b * 0.62, r: (c - 0.5) * 8 };
}

export const projectSpot = (i: number, key: string) => projectSpots[i] ?? looseSpot(key);
export const noteSpot = (i: number, key: string) => noteSpots[i] ?? looseSpot(key);
