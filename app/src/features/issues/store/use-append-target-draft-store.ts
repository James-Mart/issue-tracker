import { create } from "zustand";

type AppendTargetDraftState = {
  rejectedById: Record<string, boolean>;
  setRejected: (ideaId: string, rejected: boolean) => void;
};

const initialRejectedById: Record<string, boolean> = {};

export const useAppendTargetDraftStore = create<AppendTargetDraftState>(
  (set) => ({
    rejectedById: initialRejectedById,
    setRejected: (ideaId, rejected) =>
      set((state) => {
        if (!rejected) {
          if (!(ideaId in state.rejectedById)) return state;
          const { [ideaId]: _dropped, ...rest } = state.rejectedById;
          return { rejectedById: rest };
        }
        if (state.rejectedById[ideaId]) return state;
        return { rejectedById: { ...state.rejectedById, [ideaId]: true } };
      }),
  }),
);

export function resetAppendTargetDraftStore(): void {
  useAppendTargetDraftStore.setState({ rejectedById: {} });
}
