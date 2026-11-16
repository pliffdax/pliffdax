const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const long = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const fmtShort = (d: Date) => short.format(d);
export const fmtLong = (d: Date) => long.format(d);
export const iso = (d: Date) => d.toISOString().slice(0, 10);

export function readingTime(text: string) {
  const words = text.trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 220))} min`;
}
