/**
 * Configuration for Mimic Release download availability.
 *
 * To re-enable downloads when the updated version is released:
 * Set `downloadsEnabled: true`.
 */
export interface MimicReleaseConfig {
  downloadsEnabled: boolean;
  status: 'updating' | 'available' | 'maintenance';
  title: string;
  badgeLabel: string;
  statusMessage: string;
  paragraphs: string[];
}

export const mimicRelease: MimicReleaseConfig = {
  // Updated 2026-11-18: v1.4.5 (build 3014) is published from the main
  // repository at github.com/IbemCabahug/mimic (the old mimic-release repo is private).
  downloadsEnabled: true,
  status: 'available',
  badgeLabel: 'v1.4.5 Available',
  title: 'Free Download Available',
  statusMessage:
    'Mimic v1.4.5 is free to download from the main GitHub repository. No activation code is needed.',
  paragraphs: [
    'Mimic v1.4.5 is free to download from the main GitHub repository.',
    'No activation code is needed to get started.',
  ],
};

/**
 * Returns whether downloads are enabled for a given project slug.
 */
export function isProjectDownloadEnabled(slug: string): boolean {
  if (slug === 'mimic') {
    return mimicRelease.downloadsEnabled;
  }
  return true;
}
