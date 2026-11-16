import { getCollection } from 'astro:content';

export async function getNotes() {
  const notes = await getCollection('notes', ({ data }) => import.meta.env.DEV || !data.draft);
  return notes.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id));
}

export async function getProjects() {
  const projects = await getCollection('projects', ({ data }) => import.meta.env.DEV || !data.draft);
  return projects.sort((a, b) => a.data.order - b.data.order);
}

export async function getSocials() {
  const socials = await getCollection('socials');
  return socials.sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
}
