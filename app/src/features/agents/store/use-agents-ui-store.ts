import { create } from "zustand";

interface AgentsUiState {
  createDialogOpen: boolean;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;
  deleteTargetId: string | null;
  requestDelete: (id: string) => void;
  clearDelete: () => void;
  renamingId: string | null;
  startRename: (id: string) => void;
  clearRename: () => void;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
}

export const useAgentsUiStore = create<AgentsUiState>((set) => ({
  createDialogOpen: false,
  openCreateDialog: () => set({ createDialogOpen: true }),
  closeCreateDialog: () => set({ createDialogOpen: false }),
  deleteTargetId: null,
  requestDelete: (id) => set({ deleteTargetId: id }),
  clearDelete: () => set({ deleteTargetId: null }),
  renamingId: null,
  startRename: (id) => set({ renamingId: id }),
  clearRename: () => set({ renamingId: null }),
  showArchived: false,
  setShowArchived: (value) => set({ showArchived: value }),
}));
