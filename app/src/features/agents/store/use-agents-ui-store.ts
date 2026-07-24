import { create } from "zustand";

interface AgentsUiState {
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;
  createDialogOpen: boolean;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;
  deleteTargetId: string | null;
  requestDelete: (id: string) => void;
  clearDelete: () => void;
  renamingId: string | null;
  startRename: (id: string) => void;
  clearRename: () => void;
}

export const useAgentsUiStore = create<AgentsUiState>((set) => ({
  selectedConversationId: null,
  setSelectedConversationId: (id) => set({ selectedConversationId: id }),
  createDialogOpen: false,
  openCreateDialog: () => set({ createDialogOpen: true }),
  closeCreateDialog: () => set({ createDialogOpen: false }),
  deleteTargetId: null,
  requestDelete: (id) => set({ deleteTargetId: id }),
  clearDelete: () => set({ deleteTargetId: null }),
  renamingId: null,
  startRename: (id) => set({ renamingId: id }),
  clearRename: () => set({ renamingId: null }),
}));
