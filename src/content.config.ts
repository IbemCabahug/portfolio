import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const profile = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/profile" }),
  schema: z.object({
    name: z.string(),
    title: z.string(),
    tagline: z.string(),
    location: z.string(),
    email: z.email(),
    github: z.url(),
    resumeFile: z.string(),
    availability: z.string(),
  }),
});

const skills = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/skills" }),
  schema: z.object({
    category: z.string(),
    items: z.array(
      z.object({
        name: z.string(),
        level: z.enum(["learning", "working", "confident"]),
      })
    ),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    summary: z.string().optional(),
    role: z.string(),
    status: z.enum(["Shipped", "In progress", "Archived"]),
    stack: z.array(z.string()),
    thumbnail: z.string().optional(),
    liveUrl: z.url().optional(),
    sourceUrl: z.url().optional(),
    allowFraming: z.boolean().optional(),
    featured: z.boolean(),
    order: z.number(),
  }),
});

const npc = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/npc" }),
  schema: z.object({
    question: z.string(),
    answer: z.string().optional(),
    order: z.number(),
    offerLabel: z.string().optional(),
    offerHref: z.string().optional(),
    followUp: z.string().optional(),
  }),
});

const innkeeper = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/innkeeper" }),
  schema: z.object({
    line: z.string().optional(),
    order: z.number(),
    question: z.string().optional(),
    answer: z.string().optional(),
    offerLabel: z.string().optional(),
    offerHref: z.string().optional(),
    followUp: z.string().optional(),
  }),
});

const links = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/links" }),
  schema: z.object({
    label: z.string(),
    plainLabel: z.string(),
    url: z.url(),
    icon: z.string(),
  }),
});

const resume = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/resume" }),
  schema: z.object({
    experience: z.array(z.object({
      role: z.string(),
      org: z.string(),
      period: z.string(),
      hours: z.string().optional(),
      bullets: z.array(z.string()),
    })),
    education: z.array(z.object({
      credential: z.string(),
      school: z.string(),
      period: z.string(),
      honors: z.array(z.string()),
    })),
    training: z.array(z.object({
      name: z.string(),
      provider: z.string(),
      hours: z.string(),
    })),
    languages: z.array(z.object({
      name: z.string(),
      level: z.string(),
    })),
  }),
});

export const collections = {
  profile,
  skills,
  projects,
  npc,
  innkeeper,
  links,
  resume,
};
