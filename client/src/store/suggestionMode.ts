import { create } from 'zustand'

/**
 * How the engine treats a state requirement it cannot satisfy from what is already scheduled.
 *
 * - `strict` measures every requirement against the day as it actually stands, so the trip home is
 *   impossible on a day whose only trip in is still a suggestion.
 * - `chained` lets each placed suggestion set its states as though it had happened, so a whole day
 *   can be proposed from an empty one. Those suggestions carry `unlockedBy`.
 */
export type SuggestionMode = 'strict' | 'chained'

const STORAGE_KEY = 'stryde-suggestion-mode'

interface SuggestionModeState {
  mode: SuggestionMode
  setMode: (mode: SuggestionMode) => void
}

// Per device rather than per account: this is which view of the day you are looking at, and the
// answer is cheap enough to flip that it never needed a round trip to store.
export const useSuggestionMode = create<SuggestionModeState>((set) => ({
  mode: localStorage.getItem(STORAGE_KEY) === 'chained' ? 'chained' : 'strict',
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    set({ mode })
  },
}))
