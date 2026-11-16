// What I'm doing right now. Newest first; the first entry is shown on the desk,
// the rest live on the back of the "Now" note.
export type NowEntry = { date: string; text: string };

export const now: [NowEntry, ...NowEntry[]] = [
  { date: '2026-11-16', text: 'Setting up this site from an empty README.' },
];

export const site = {
  name: 'pliffdax',
  domain: 'pliffdax.dev',
  tagline: 'Projects, short notes and experiments.',
  source: 'https://github.com/pliffdax/pliffdax',
};
