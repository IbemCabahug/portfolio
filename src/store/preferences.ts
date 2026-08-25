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
  return (document.documentElement.dataset.motion as MotionPref) || 'reduced';
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
  return (document.documentElement.dataset.sound as SoundPref) || 'off';
}

export function setSound(val: SoundPref) {
  if (typeof window === 'undefined') return;
  document.documentElement.dataset.sound = val;
  try {
    localStorage.setItem('sound', val);
  } catch (e) {}
  notify();
}
