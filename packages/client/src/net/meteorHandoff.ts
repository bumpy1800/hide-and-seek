/**
 * Pure multi-session handoff: transfer peer ownership at most once.
 * Used so startRace→onSnap and UI never double-start MeteorGame with peer:null.
 */
export type HandoffState<T> = {
  handedOff: boolean;
  peer: T | null;
};

export type HandoffResult<T> = {
  state: HandoffState<T>;
  /** Non-null only on the first successful take. */
  taken: T | null;
};

export function takePeerHandoff<T>(
  state: HandoffState<T>,
  peer: T | null,
): HandoffResult<T> {
  if (state.handedOff || peer == null) {
    return { state, taken: null };
  }
  return {
    state: { handedOff: true, peer: null },
    taken: peer,
  };
}
