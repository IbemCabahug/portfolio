export type MotionPref = 'full' | 'reduced';
export type SoundPref = 'on' | 'off';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(l => l());
}

export function subscribePreferences(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMotion(): MotionPref {
  if (typeof window === 'undefined') return 'reduced';
  const current = document.documentElement.dataset.motion as MotionPref;
  if (current === 'full' || current === 'reduced') return current;
  try {
    const stored = localStorage.getItem('motion') as MotionPref;
    if (stored === 'full' || stored === 'reduced') {
      document.documentElement.dataset.motion = stored;
      return stored;
    }
  } catch (e) {}
  return 'reduced';
}

export function setMotion(val: MotionPref) {
  if (typeof window === 'undefined') return;
  document.documentElement.dataset.motion = val;
  try {
    localStorage.setItem('motion', val);
  } catch (e) {}
  notify();
}

export function getSound(): SoundPref {
  if (typeof window === 'undefined') return 'off';
  const current = document.documentElement.dataset.sound as SoundPref;
  if (current === 'on' || current === 'off') return current;
  try {
    const stored = localStorage.getItem('sound') as SoundPref;
    if (stored === 'on' || stored === 'off') {
      document.documentElement.dataset.sound = stored;
      return stored;
    }
  } catch (e) {}
  return 'off';
}

export function setSound(val: SoundPref) {
  if (typeof window === 'undefined') return;
  document.documentElement.dataset.sound = val;
  try {
    localStorage.setItem('sound', val);
  } catch (e) {}
  notify();
}
