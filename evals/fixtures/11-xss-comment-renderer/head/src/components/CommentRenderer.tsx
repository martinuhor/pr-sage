import type { Comment } from "../types";

export interface CommentRendererProps {
  comment: Comment;
}

/**
 * Renders a single PR comment. The author's body is kept as HTML so that
 * links, bold text and fenced code survive the round-trip to the browser.
 */
export function CommentRenderer({ comment }: CommentRendererProps) {
  return (
    <article className="comment">
      <header className="comment-author">{comment.author}</header>
      <div
        className="comment-body"
        dangerouslySetInnerHTML={{ __html: comment.body }}
      />
    </article>
  );
}
