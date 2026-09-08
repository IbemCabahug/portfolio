/**
 * Client-side discovery store for the Wayfarer's Journal (Visitor Quest Log).
 * Stored strictly in the user's localStorage (zero analytics, zero backend).
 */

export interface JournalMilestone {
  id: string;
  title: string;
  category: 'chamber' | 'dossier';
  path: string;
  tagline: string;
  iconName: string;
}

export const JOURNAL_MILESTONES: JournalMilestone[] = [
  // Chambers of the Tavern
  {
    id: 'tavern',
    title: 'The Common Taproom (Tavern)',
    category: 'chamber',
    path: '/tavern',
    tagline: 'Warm hearth, taproom banter, and atmospheric company',
    iconName: 'tavern',
  },
  {
    id: 'quests',
    title: 'The Notice Board (Projects)',
    category: 'chamber',
    path: '/quests',
    tagline: 'Guild bounties, active software projects, and tech stacks',
    iconName: 'scroll',
  },
  {
    id: 'messenger',
    title: "The Courier's Roost (Contact)",
    category: 'chamber',
    path: '/messenger',
    tagline: 'Messenger aviary, direct email dispatch, and Arcane Transceiver',
    iconName: 'raven',
  },
  {
    id: 'resume',
    title: "The Master Scribe's Ledger (Resume)",
    category: 'chamber',
    path: '/resume',
    tagline: 'Complete technical resume, employment history, and education',
    iconName: 'ledger',
  },

  // Case Study Dossiers
  {
    id: 'arcanetyper',
    title: 'Arcane Typer Dossier',
    category: 'dossier',
    path: '/quests/arcanetyper',
    tagline: 'Typing defense RPG engine, 60 FPS canvas loop & Web Audio API',
    iconName: 'code',
  },
  {
    id: 'bits',
    title: 'BITS Attendance System',
    category: 'dossier',
    path: '/quests/bits',
    tagline: 'Biometric hardware integration, multi-shift matrices & PostgreSQL',
    iconName: 'terminal',
  },
  {
    id: 'mimic',
    title: 'Mimic Vault Architecture',
    category: 'dossier',
    path: '/quests/mimic',
    tagline: 'Flutter party game and offline AES-256 encrypted hardware vault',
    iconName: 'swords',
  },
];

const STORAGE_KEY = 'wayfarer_journal';
type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {}
  });
}

export function subscribeQuestLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVisitedMilestones(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item) => typeof item === 'string'));
    }
  } catch {}
  return new Set();
}

export function recordMilestone(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getVisitedMilestones();
    if (!current.has(id)) {
      current.add(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(current)));
      notify();
    }
  } catch {}
}

export function clearJournalMilestones(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    notify();
  } catch {}
}

/**
 * Detects which milestone corresponds to a given URL pathname.
 */
export function detectMilestoneFromPath(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/';

  if (clean === '/quests/arcanetyper') return 'arcanetyper';
  if (clean === '/quests/bits') return 'bits';
  if (clean === '/quests/mimic') return 'mimic';
  if (clean === '/quests') return 'quests';
  if (clean.startsWith('/messenger')) return 'messenger';
  if (clean.startsWith('/resume')) return 'resume';
  if (clean.startsWith('/tavern')) return 'tavern';

  return null;
}
