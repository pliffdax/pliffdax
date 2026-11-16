import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    status: z.enum(['in progress', 'ongoing', 'paused', 'done']),
    started: z.coerce.date(),
    order: z.number().default(0),
    tags: z.array(z.string()).default([]),
    links: z
      .array(z.object({ label: z.string(), href: z.url() }))
      .default([]),
    draft: z.boolean().default(false),
  }),
});

// One file per network. `href` opens in a new tab; `copy: true` copies the handle instead
// (for networks without a public profile link, like Discord).
export const socialIcons = ['github', 'telegram', 'instagram', 'x', 'spotify', 'discord'] as const;

const socials = defineCollection({
  loader: glob({ pattern: '**/*.{yaml,yml}', base: './src/content/socials' }),
  schema: z
    .object({
      label: z.string(),
      handle: z.string(),
      icon: z.enum(socialIcons),
      href: z.url().optional(),
      copy: z.boolean().default(false),
      order: z.number().default(0),
    })
    .refine((s) => s.href || s.copy, { message: 'a social needs either `href` or `copy: true`' }),
});

export const collections = { notes, projects, socials };
