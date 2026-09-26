import React, { useState, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import {
  Comment,
  fetchCommentsForMarket,
  createCommentForMarket,
  deleteCommentApi,
  reportCommentApi,
} from "./lib/commentsApi";

interface CommentSectionProps {
  marketId: string;
}

const REPORT_REASONS = [
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment" },
  { id: "offensive", label: "Offensive content" },
  { id: "misleading", label: "Misleading content" },
  { id: "other", label: "Other" },
];

function formatTimeAgo(rawDate: string | number): string {
  try {
    const date = new Date(rawDate);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (isNaN(date.getTime()) || diffSec < 0 || diffSec < 45) {
      return "Just now";
    }

    const minutes = Math.floor(diffSec / 60);
    if (minutes < 60) {
      return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    }

    const days = Math.floor(hours / 24);
    if (days < 30) {
      return days === 1 ? "1 day ago" : `${days} days ago`;
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Just now";
  }
}

export default function CommentSection({ marketId }: CommentSectionProps) {
  const {
    isAuthenticated,
    user,
    loginWithPopup,
    loginWithRedirect,
    logout,
    getIdTokenClaims,
  } = useAuth0();

  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [loading, setLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Reporting State
  const [reportTargetComment, setReportTargetComment] = useState<Comment | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>("spam");
  const [isReporting, setIsReporting] = useState<boolean>(false);

  useEffect(() => {
    if (!marketId) {
      setComments([]);
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);
    setComments([]);

    fetchCommentsForMarket(marketId)
      .then((data) => {
        if (!isMounted) return;
        setComments(data);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load comments from backend API:", err);
        setError("Unable to load comments.");
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [marketId]);

  const handleSignIn = async () => {
    try {
      setError(null);
      await loginWithPopup();
    } catch (err: any) {
      console.error("Auth0 login error:", err);
      if (err?.error !== "popup_closed_by_user") {
        try {
          await loginWithRedirect();
        } catch (redirectErr) {
          setError("Unable to complete sign-in. Please try again.");
        }
      }
    }
  };

  const handleLogout = () => {
    logout({
      logoutParams: {
        returnTo: window.location.origin,
      },
    });
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCommentText.trim();
    if (isPosting) return;

    if (!trimmed) {
      setError("Comment cannot be empty.");
      return;
    }

    if (trimmed.length > 500) {
      setError("Comment must be 500 characters or fewer.");
      return;
    }

    if (!isAuthenticated || !user) {
      setError("Sign in to join the discussion.");
      return;
    }

    setIsPosting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      let token: string | undefined = undefined;
      try {
        const claims = await getIdTokenClaims();
        token = claims?.__raw;
      } catch (tokenErr) {
        console.warn("Could not fetch Auth0 ID token:", tokenErr);
      }

      const newComment = await createCommentForMarket(
        marketId,
        trimmed,
        token
      );

      setComments((prev) => [newComment, ...prev]);
      setNewCommentText("");
    } catch (err: any) {
      console.error("Failed to post comment:", err);
      setError(err?.message || "Unable to post comment. Please try again.");
    } finally {
      setIsPosting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (deletingId) return;
    setDeletingId(commentId);
    setError(null);
    setSuccessMsg(null);

    try {
      let token: string | undefined = undefined;
      try {
        const claims = await getIdTokenClaims();
        token = claims?.__raw;
      } catch (tokenErr) {
        console.warn("Could not fetch Auth0 ID token:", tokenErr);
      }

      await deleteCommentApi(commentId, token);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err: any) {
      console.error("Failed to delete comment:", err);
      if (err?.message?.includes("Forbidden") || err?.message?.includes("403")) {
        setError("You can only delete your own comments.");
      } else {
        setError(err?.message || "Unable to delete comment.");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenReportModal = (comment: Comment) => {
    setError(null);
    setSuccessMsg(null);

    if (!isAuthenticated || !user) {
      setError("Sign in to report a comment.");
      return;
    }

    const commentUserId = comment.userId || comment.authorId;
    if (user?.sub && commentUserId === user.sub) {
      setError("You cannot report your own comment.");
      return;
    }

    setSelectedReason("spam");
    setReportTargetComment(comment);
  };

  const handleSubmitReport = async () => {
    if (!reportTargetComment || isReporting) return;

    setIsReporting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      let token: string | undefined = undefined;
      try {
        const claims = await getIdTokenClaims();
        token = claims?.__raw;
      } catch (tokenErr) {
        console.warn("Could not fetch Auth0 ID token for report:", tokenErr);
      }

      const res = await reportCommentApi(reportTargetComment.id, selectedReason, token);
      
      setReportTargetComment(null);
      if (res.alreadyReported) {
        setSuccessMsg("You have already reported this comment.");
      } else {
        setSuccessMsg("Report submitted successfully. Thank you for keeping PRISM safe.");
      }
    } catch (err: any) {
      console.error("Failed to submit report:", err);
      setError(err?.message || "Unable to submit report.");
    } finally {
      setIsReporting(false);
    }
  };

  const isPostDisabled =
    !isAuthenticated ||
    isPosting ||
    !newCommentText.trim() ||
    newCommentText.length > 500;

  return (
    <div className="comment-section">
      <div className="comment-section-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h3 className="comment-section-title">Comments</h3>
          <span className="comment-count">{comments.length}</span>
        </div>
        <p className="comment-section-subtitle">
          Join the discussion about this market.
        </p>
      </div>

      {error && (
        <div className="comment-alert-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="comment-alert-close"
          >
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="comment-alert-success" role="status">
          <span>{successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="comment-alert-close"
          >
            ✕
          </button>
        </div>
      )}

      {!isAuthenticated ? (
        <div className="comment-auth-prompt">
          <div className="comment-auth-prompt-content">
            <div className="comment-auth-prompt-text">
              <strong>Sign in to join the discussion.</strong>
            </div>
            <button
              type="button"
              className="comment-signin-btn"
              onClick={handleSignIn}
            >
              Sign In
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="comment-user-bar">
            <div className="comment-user-info">
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt={user.name || "User profile"}
                  className="comment-user-avatar"
                />
              ) : (
                <div className="comment-avatar">
                  {(user?.name || user?.nickname || user?.email || "U")
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}
              <div className="comment-user-details">
                <span className="comment-user-name">
                  {user?.name || user?.nickname || user?.email}
                </span>
                <span className="comment-user-badge">
                  Authenticated via Auth0
                </span>
              </div>
            </div>
            <button
              type="button"
              className="comment-logout-btn"
              onClick={handleLogout}
              title="Sign Out"
            >
              Sign Out
            </button>
          </div>

          <form className="comment-input-area" onSubmit={handlePostComment}>
            <textarea
              className="comment-textarea"
              placeholder="Write a comment..."
              maxLength={500}
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              aria-label="Comment text"
              disabled={isPosting}
            />
            <div className="comment-input-footer">
              <span className="comment-char-count">
                Characters: {newCommentText.length}/500
              </span>
              <button
                type="submit"
                className="comment-post-btn"
                disabled={isPostDisabled}
              >
                {isPosting ? "Posting..." : "Post Comment"}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="comments-loading">
          Loading comments...
        </div>
      ) : comments.length === 0 ? (
        <div className="comments-empty">
          <div className="comments-empty-icon">💬</div>
          <div className="comments-empty-title">No comments yet.</div>
          <div className="comments-empty-subtitle">
            Be the first to join the discussion.
          </div>
        </div>
      ) : (
        <div className="comments-list">
          {comments.map((comment) => {
            const authorName = comment.userName || comment.authorName || "User";
            const authorAvatar = comment.userPicture || comment.authorAvatar;
            const commentUserId = comment.userId || comment.authorId;
            const commentContent = comment.content || comment.text || "";
            const initial = authorName.charAt(0).toUpperCase();

            // Ownership check: matches Auth0 user.sub against comment userId/authorId
            const isOwner = Boolean(
              isAuthenticated &&
                user?.sub &&
                commentUserId &&
                commentUserId === user.sub
            );

            return (
              <div key={comment.id} className="comment-card">
                <div className="comment-card-top">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    {authorAvatar ? (
                      <img
                        src={authorAvatar}
                        alt={authorName}
                        className="comment-avatar-img"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="comment-avatar">{initial}</div>
                    )}
                    <div>
                      <div className="comment-author">{authorName}</div>
                      <div className="comment-timestamp">
                        {formatTimeAgo(comment.createdAt)}
                      </div>
                    </div>
                  </div>

                  {isOwner ? (
                    <button
                      type="button"
                      className="comment-delete"
                      disabled={deletingId === comment.id}
                      onClick={() => handleDeleteComment(comment.id)}
                      aria-label="Delete comment"
                    >
                      {deletingId === comment.id ? "Deleting..." : "Delete"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="comment-report-btn"
                      onClick={() => handleOpenReportModal(comment)}
                      aria-label="Report comment"
                    >
                      🚩 Report
                    </button>
                  )}
                </div>
                {/* Safe plain text rendering (no HTML execution) */}
                <div className="comment-text">{commentContent}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Report Modal */}
      {reportTargetComment && (
        <div className="report-modal-overlay" onClick={() => setReportTargetComment(null)}>
          <div className="report-modal-card" onClick={(e) => e.stopPropagation()}>
            <h4 className="report-modal-title">Report Comment</h4>
            <p style={{ fontSize: "0.85rem", color: "var(--prism-text-secondary, #6F747D)", margin: "0 0 10px 0" }}>
              Please select a reason for reporting this comment by {reportTargetComment.userName || reportTargetComment.authorName || "User"}:
            </p>

            <div className="report-reasons-list">
              {REPORT_REASONS.map((r) => (
                <label key={r.id} className="report-reason-item">
                  <input
                    type="radio"
                    name="reportReason"
                    value={r.id}
                    checked={selectedReason === r.id}
                    onChange={(e) => setSelectedReason(e.target.value)}
                  />
                  <span className="report-reason-label">{r.label}</span>
                </label>
              ))}
            </div>

            <div className="report-modal-actions">
              <button
                type="button"
                className="report-modal-cancel"
                onClick={() => setReportTargetComment(null)}
                disabled={isReporting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="report-modal-submit"
                onClick={handleSubmitReport}
                disabled={isReporting || !selectedReason}
              >
                {isReporting ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
