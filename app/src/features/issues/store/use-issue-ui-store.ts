import { create } from "zustand";
import type { IssueKind } from "@server/schemas";
import type { BoardKindFilter } from "../lib/board-kind-filter";
import {
  ensureBoardRootsExpandedOnce,
  loadExpanded,
  saveExpanded,
  toggleExpanded,
} from "./expanded-state";

export type { BoardKindFilter };

interface NewIssueTarget {
  presetKind?: IssueKind;
  presetParent?: string;
  presetStackedOn?: string;
}

// The project-create/rename dialog target. `id` present => rename that project.
export interface ProjectDialogTarget {
  id?: string;
  title?: string;
}

interface IssueUiState {
  search: string;
  setSearch: (value: string) => void;
  /** Selected Project catalog label ids for the tree OR-filter (in-memory). */
  labelFilter: string[];
  setLabelFilter: (ids: string[]) => void;
  boardKindFilter: BoardKindFilter;
  setBoardKindFilter: (value: BoardKindFilter) => void;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  expanded: Record<string, boolean>;
  toggle: (id: string, fallbackExpanded: boolean) => void;
  ensureBoardRootsExpandedOnce: (boardRootIds: readonly string[]) => void;
  projectDialog: ProjectDialogTarget | null;
  openProjectDialog: (target?: ProjectDialogTarget) => void;
  closeProjectDialog: () => void;
  newIssue: NewIssueTarget | null;
  openNew: (target?: NewIssueTarget) => void;
  closeNew: () => void;
  deleteTarget: string | null;
  requestDelete: (id: string) => void;
  clearDelete: () => void;
}

export const useIssueUiStore = create<IssueUiState>((set) => ({
  search: "",
  setSearch: (value) => set({ search: value }),
  labelFilter: [],
  setLabelFilter: (ids) => set({ labelFilter: ids }),
  boardKindFilter: [],
  setBoardKindFilter: (value) => set({ boardKindFilter: value }),
  showArchived: false,
  setShowArchived: (value) => set({ showArchived: value }),
  expanded:
    typeof localStorage === "undefined" ? {} : loadExpanded(),
  toggle: (id, fallbackExpanded) =>
    set((state) => {
      const expanded = toggleExpanded(state.expanded, id, fallbackExpanded);
      saveExpanded(expanded);
      return { expanded };
    }),
  ensureBoardRootsExpandedOnce: (boardRootIds) =>
    set((state) => {
      const expanded = ensureBoardRootsExpandedOnce(
        state.expanded,
        boardRootIds,
      );
      if (expanded === state.expanded) return state;
      return { expanded };
    }),
  projectDialog: null,
  openProjectDialog: (target) => set({ projectDialog: target ?? {} }),
  closeProjectDialog: () => set({ projectDialog: null }),
  newIssue: null,
  openNew: (target) => set({ newIssue: target ?? {} }),
  closeNew: () => set({ newIssue: null }),
  deleteTarget: null,
  requestDelete: (id) => set({ deleteTarget: id }),
  clearDelete: () => set({ deleteTarget: null }),
}));
