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
  downloadsEnabled: false,
  status: 'updating',
  badgeLabel: 'Updates in Progress',
  title: 'Downloads Temporarily Unavailable',
  statusMessage:
    'Mimic Release is currently undergoing improvements and updates. Public downloads have been temporarily disabled while I prepare the next version. The download feature will return once the updated release is ready. Thank you for your patience.',
  paragraphs: [
    'Mimic Release is currently undergoing improvements and updates. Public downloads have been temporarily disabled while I prepare the next version.',
    'The download feature will return once the updated release is ready.',
    'Thank you for your patience.',
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
