import { create } from "zustand";

type CommentEditState = {
  errors: Record<string, string>;
  pending: Record<string, true>;
  begin: (commentId: string) => void;
  end: (commentId: string) => void;
  fail: (commentId: string, error: string) => void;
  clearError: (commentId: string) => void;
};

export const useCommentEditStore = create<CommentEditState>((set) => ({
  errors: {},
  pending: {},
  begin: (commentId) =>
    set((state) => ({
      pending: { ...state.pending, [commentId]: true },
      errors: omitKey(state.errors, commentId),
    })),
  end: (commentId) =>
    set((state) => ({ pending: omitKey(state.pending, commentId) })),
  fail: (commentId, error) =>
    set((state) => ({
      errors: { ...state.errors, [commentId]: error },
    })),
  clearError: (commentId) =>
    set((state) => ({ errors: omitKey(state.errors, commentId) })),
}));

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function resetCommentEditStore(): void {
  useCommentEditStore.setState({ errors: {}, pending: {} });
}
