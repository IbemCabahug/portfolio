import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';

Object.assign(process.env, loadEnv(process.env.NODE_ENV || 'production', process.cwd(), ''));

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || undefined,
  integrations: [
    react(),
    mdx(),
    sitemap(),
  ],
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },
  adapter: vercel(),
});
