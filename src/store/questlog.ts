/**
 * Client-side discovery store for the Wayfarer's Journal (Visitor Quest Log & Achievements).
 * Stored strictly in the user's localStorage (zero analytics, zero backend tracking).
 */

export type MilestoneCategory = 'chamber' | 'dossier' | 'feat';

export interface JournalMilestone {
  id: string;
  title: string;
  category: MilestoneCategory;
  path?: string;
  tagline: string;
  iconName: string;
  actionHint?: string;
}

export const JOURNAL_MILESTONES: JournalMilestone[] = [
  // ── Part 1: Chambers of the Tavern (Exploration) ─────────────────────
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
    title: 'The Notice Board',
    category: 'chamber',
    path: '/quests',
    tagline: 'Guild bounties, active software projects, and tech stacks',
    iconName: 'scroll',
  },
  {
    id: 'messenger',
    title: "The Courier's Roost",
    category: 'chamber',
    path: '/messenger',
    tagline: 'Messenger aviary, direct email dispatch, and Arcane Transceiver',
    iconName: 'raven',
  },
  {
    id: 'resume',
    title: "The Master Scribe's Ledger",
    category: 'chamber',
    path: '/resume',
    tagline: 'Complete technical resume, employment history, and education',
    iconName: 'ledger',
  },
  {
    id: 'tales',
    title: "Field Dispatches (The Scribe's Desk)",
    category: 'chamber',
    path: '/tales',
    tagline: 'Technical writing, systems architecture deep dives, and edge cases',
    iconName: 'scroll',
  },

  // ── Part 2: Case Study Dossiers (Deep Technical Reading) ──────────────
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

  // ── Part 3: Guild Feats & Deeds (Interactive Trials) ─────────────────
  {
    id: 'feat_hearth',
    title: 'Kindle the Hearthfire',
    category: 'feat',
    tagline: 'Ignite the ambient procedural fireplace soundscape in the header controls',
    iconName: 'candle',
    actionHint: 'Toggle "Sound: On" in the top bar or mobile menu',
  },
  {
    id: 'feat_transceiver',
    title: 'Tuning the Transceiver',
    category: 'feat',
    path: '/messenger',
    tagline: 'Engage a live interactive project trial in the Arcane Transceiver',
    iconName: 'terminal',
    actionHint: 'Visit the Courier\'s Roost and launch any project simulation',
  },
  {
    id: 'feat_mimic_vault',
    title: 'The Mimic Decrypted',
    category: 'feat',
    path: '/quests/mimic',
    tagline: 'Unlock the concealed cryptographic vault using secret PIN 1337',
    iconName: 'swords',
    actionHint: 'In the Mimic simulator, enter PIN 1337 or use fingerprint recognition',
  },
  {
    id: 'feat_bits_punch',
    title: 'Clockwork Shifter',
    category: 'feat',
    path: '/quests/bits',
    tagline: 'Trigger a biometric telemetry punch scenario in the BITS engine simulator',
    iconName: 'terminal',
    actionHint: 'In the BITS simulator, click any attendance scenario button',
  },
  {
    id: 'feat_tavern_dialogue',
    title: 'Taproom Confidant',
    category: 'feat',
    path: '/tavern',
    tagline: 'Confer with the Tavern Innkeeper or Regular about architectural lore',
    iconName: 'tavern',
    actionHint: 'Click an inquiry topic when speaking with any tavern NPC',
  },
  {
    id: 'feat_raven_missive',
    title: "Courier's Dispatch",
    category: 'feat',
    path: '/messenger',
    tagline: 'Compose or prepare an inquiry missive to send via the Tavern Raven',
    iconName: 'raven',
    actionHint: 'Click "Send Missive" or copy the missive address in the Courier\'s Roost',
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

      // Emit event for real-time celebration toast
      const milestone = JOURNAL_MILESTONES.find((m) => m.id === id);
      if (milestone) {
        window.dispatchEvent(
          new CustomEvent('milestone-unlocked', {
            detail: { id, milestone },
          })
        );
      }
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

export interface AdventurerRank {
  rank: string;
  tier: number;
  title: string;
  badgeIcon: string;
  colorClass: string;
}

export function getAdventurerRank(count: number): AdventurerRank {
  const total = JOURNAL_MILESTONES.length;
  if (count >= total) {
    return {
      rank: 'Grandmaster Guildmaster',
      tier: 5,
      title: 'Grandmaster of Ibem’s Realm',
      badgeIcon: '👑',
      colorClass: 'text-amber-500 font-extrabold',
    };
  }
  if (count >= 11) {
    return {
      rank: 'Master Wayfarer',
      tier: 4,
      title: 'Master Wayfarer & Systems Inquisitor',
      badgeIcon: '⭐',
      colorClass: 'text-amber-600 font-bold',
    };
  }
  if (count >= 8) {
    return {
      rank: 'Veteran Adventurer',
      tier: 3,
      title: 'Veteran Guild Adventurer',
      badgeIcon: '🗡️',
      colorClass: 'text-yellow-700 font-bold',
    };
  }
  if (count >= 4) {
    return {
      rank: 'Journeyman Explorer',
      tier: 2,
      title: 'Journeyman Explorer of the Taproom',
      badgeIcon: '📜',
      colorClass: 'text-stone-700 font-semibold',
    };
  }
  return {
    rank: 'Wayfarer Initiate',
    tier: 1,
    title: 'Wayfarer Initiate at the Threshold',
    badgeIcon: '🕯️',
    colorClass: 'text-stone-600 font-medium',
  };
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
  if (clean.startsWith('/tales')) return 'tales';
  if (clean.startsWith('/tavern')) return 'tavern';

  return null;
}
