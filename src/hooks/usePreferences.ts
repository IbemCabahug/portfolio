import { useSyncExternalStore } from 'react';
import { getMotion, getSound, subscribePreferences, type MotionPref, type SoundPref } from '../store/preferences';

export function useMotion(): MotionPref {
  return useSyncExternalStore(subscribePreferences, getMotion, () => 'reduced');
}

export function useSound(): SoundPref {
  return useSyncExternalStore(subscribePreferences, getSound, () => 'off');
}
