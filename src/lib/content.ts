import { getCollection } from 'astro:content';

export async function getProfile() {
  const all = await getCollection('profile');
  return all[0];
}

export async function getSkills() {
  return getCollection('skills');
}

export async function getProjects() {
  return getCollection('projects');
}

export async function getNpc() {
  return getCollection('npc');
}

export async function getInnkeeper() {
  return getCollection('innkeeper');
}

export async function getLinks() {
  return getCollection('links');
}
