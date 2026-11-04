import { useLocation, useNavigate } from "react-router-dom";
import { useCreateIssue, useUpdateIssue } from "../api/mutations";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "./issue-back";
import { issuePath } from "./links";

/** Create a blank Idea with `appendTo` set, then navigate to it with issue-back state. */
export function useCreateAppendIdea(projectId: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();

  const createAppendIdea = async (storyId: string, title: string) => {
    const created = await createIssue.mutateAsync({
      kind: "idea",
      title,
      partOf: projectId,
    });
    await updateIssue.mutateAsync({
      id: created.id,
      patch: { appendTo: storyId },
    });
    const navigateState = issueBackNavigateState(
      location.pathname,
      location.search,
      (location.state as IssueBackLocationState | null)?.issueBackStack,
    );
    navigate(
      issuePath(projectId, created.id),
      navigateState ? { state: navigateState } : undefined,
    );
  };

  return {
    createAppendIdea,
    isPending: createIssue.isPending || updateIssue.isPending,
  };
}
