import type { Comment } from "../types";
import { CommentRenderer } from "./CommentRenderer";

export interface CommentListProps {
  comments: Comment[];
  permalink: string;
}

export function CommentList({ comments, permalink }: CommentListProps) {
  return (
    <section className="comments">
      {comments.map((comment) => (
        <CommentRenderer key={comment.id} comment={comment} />
      ))}
      <a href={permalink} target="_blank">
        View on GitHub
      </a>
    </section>
  );
}
