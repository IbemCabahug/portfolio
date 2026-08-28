import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';

Object.assign(process.env, loadEnv(process.env.NODE_ENV || 'production', process.cwd(), ''));

const isProductionDeployment = !!(process.env.CI || process.env.VERCEL);
const siteUrl = process.env.PUBLIC_SITE_URL || '';

if (isProductionDeployment && (!siteUrl || siteUrl.includes('localhost'))) {
  throw new Error("Missing or invalid PUBLIC_SITE_URL for production build. Please set PUBLIC_SITE_URL in Vercel or your CI environment variables.");
}

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || undefined,
  integrations: [

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
