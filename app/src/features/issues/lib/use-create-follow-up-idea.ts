import { useLocation, useNavigate } from "react-router-dom";
import { useCreateIssue } from "../api/mutations";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "./issue-back";
import { issuePath } from "./links";

/** Create an ordinary Idea in the Project, then navigate to it with issue-back state. */
export function useCreateFollowUpIdea(projectId: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const createIssue = useCreateIssue();

  const createFollowUpIdea = async (title: string) => {
    const created = await createIssue.mutateAsync({
      kind: "idea",
      title,
      partOf: projectId,
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
    createFollowUpIdea,
    isPending: createIssue.isPending,
  };
}
