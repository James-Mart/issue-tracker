import type { CommentInput } from "@server/schemas";
import { questionKindFields } from "@server/question-kind";

type IdleCommentPost = {
  isPending: boolean;
  mutate: (
    input: CommentInput,
    options: { onSuccess: () => void; onError: () => void },
  ) => void;
};

/**
 * Posts a comment unless one is already in flight.
 * A second Enter can land before React re-renders `pending`.
 */
export function postCommentWhenIdle(
  post: IdleCommentPost,
  input: CommentInput,
): Promise<void> {
  if (post.isPending) {
    return Promise.reject(new Error("comment was not posted"));
  }
  return new Promise((resolve, reject) => {
    post.mutate(input, {
      onSuccess: () => resolve(),
      onError: () => reject(new Error("comment was not posted")),
    });
  });
}

/** Top-level human comment, optionally posted as a question. */
export function postHumanComment(
  post: IdleCommentPost,
  body: string,
  kind?: "question",
): Promise<void> {
  return postCommentWhenIdle(post, {
    role: "human",
    body,
    ...questionKindFields(kind),
  });
}
