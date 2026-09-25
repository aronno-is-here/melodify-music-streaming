import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import AppDialog from '../../components/ui/AppDialog.jsx';
import cssRaw from './Feed.css?raw';

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getShareText(post) {
  return `Check out ${post.author?.name}'s karaoke performance of "${post.song?.title || post.karaoke?.title}" on Melodify!`;
}

export default function Feed() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Feed');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const [commentingPostId, setCommentingPostId] = useState('');
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [manualShareText, setManualShareText] = useState('');

  const fetchPosts = useCallback(async (pageNum = 1) => {
    if (pageNum === 1) {
      setLoading(true);
      setError('');
      setPage(1);
    } else {
      setLoadingMore(true);
    }

    const data = await api.get(`/api/posts?page=${pageNum}&limit=20`);

    if (!data.success) {
      if (pageNum === 1) {
        setError(data.error || 'Unable to load posts.');
      }
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    setPosts((prev) => (pageNum === 1 ? data.posts : [...prev, ...data.posts]));
    setHasMore(pageNum < data.pages);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const openComments = useCallback(async (postId) => {
    setCommentingPostId(postId);
    setCommentText('');
    setComments([]);
    setCommentsError('');
    setCommentsLoading(true);

    const data = await api.get(`/api/comments/${postId}`);
    if (!data.success) {
      setCommentsError(data.error || 'Unable to load comments.');
      setCommentsLoading(false);
      return;
    }

    setComments(data.comments || []);
    setCommentsLoading(false);
  }, []);

  const submitComment = useCallback(async () => {
    const trimmed = commentText.trim();
    if (!trimmed || submittingComment || !commentingPostId) return;

    setSubmittingComment(true);
    const data = await api.post(`/api/comments/${commentingPostId}`, { text: trimmed });
    setSubmittingComment(false);

    if (!data.success) {
      setCommentsError(data.error || 'Unable to post comment.');
      return;
    }

    setComments((prev) => [...prev, data.comment]);
    setPosts((prev) => prev.map((post) => (
      post._id === commentingPostId
        ? { ...post, commentsCount: (post.commentsCount || 0) + 1 }
        : post
    )));
    setCommentText('');
    setCommentsError('');
  }, [commentText, commentingPostId, submittingComment]);

  const deleteComment = useCallback(async (commentId) => {
    const data = await api.del(`/api/comments/${commentId}`);
    if (!data.success) {
      setCommentsError(data.error || 'Unable to delete comment.');
      return;
    }

    setComments((prev) => prev.filter((comment) => comment._id !== commentId));
    setPosts((prev) => prev.map((post) => (
      post._id === commentingPostId
        ? { ...post, commentsCount: Math.max(0, (post.commentsCount || 0) - 1) }
        : post
    )));
    setCommentsError('');
  }, [commentingPostId]);

  const handleLike = useCallback(async (postId) => {
    const snapshot = posts;
    const target = posts.find((post) => post._id === postId);
    if (!target) return;

    setPosts((prev) => prev.map((post) => (
      post._id === postId
        ? {
          ...post,
          isLiked: !post.isLiked,
          likesCount: post.isLiked ? Math.max(0, (post.likesCount || 0) - 1) : (post.likesCount || 0) + 1,
        }
        : post
    )));

    const result = target.isLiked
      ? await api.del(`/api/likes/${postId}`)
      : await api.post(`/api/likes/${postId}`);

    if (!result.success) {
      setPosts(snapshot);
      setStatusMessage(result.error || 'Unable to update like right now.');
    }
  }, [posts]);

  const sharePost = useCallback(async (post) => {
    const shareUrl = `${window.location.origin}/user/${post.author?._id}`;
    const shareText = getShareText(post);

    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, text: shareText, url: shareUrl });
        return;
      } catch {
        return;
      }
    }

    const payload = `${shareText}\n${shareUrl}`;
    try {
      await navigator.clipboard.writeText(payload);
      setStatusMessage('Share link copied to clipboard.');
      setManualShareText('');
    } catch {
      setManualShareText(payload);
    }
  }, []);

  const activePost = useMemo(
    () => posts.find((post) => post._id === commentingPostId) || null,
    [commentingPostId, posts],
  );

  useEffect(() => {
    fetchPosts(1);
  }, [fetchPosts]);

  return (
    <div className="feed-page">
      <section className="music-section app-surface">
        <SectionHeader
          title="Community Feed"
          subtitle="Discover karaoke performances from the Melodify community"
          action={(
            <button type="button" className="music-outline-btn" onClick={() => fetchPosts(1)}>
              Refresh
            </button>
          )}
        />

        {statusMessage ? <p className="feed-status" role="status" aria-live="polite">{statusMessage}</p> : null}
        {error ? <p className="feed-status feed-status-error" role="alert">{error}</p> : null}

        {loading && posts.length === 0 ? (
          <p className="feed-loading" role="status">Loading posts...</p>
        ) : null}

        {!loading && posts.length === 0 ? (
          <EmptyState
            icon="fa-microphone-lines"
            title="No posts yet"
            detail="Be the first to share a karaoke performance from Melodify Studio."
          />
        ) : null}

        {posts.length > 0 ? (
          <div className="feed-post-list">
            {posts.map((post) => (
              <article key={post._id} className="feed-post-card" aria-label={`Post by ${post.author?.name}`}>
                <header className="feed-post-header">
                  <Link to={`/user/${post.author?._id}`} className="feed-author-link">
                    <span className="feed-avatar" aria-hidden="true">
                      {post.author?.avatar ? <img src={post.author.avatar} alt="" /> : post.author?.name?.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{post.author?.name}</strong>
                      <small>{formatTimeAgo(post.createdAt)}</small>
                    </span>
                  </Link>
                </header>

                <div className="feed-song-row">
                  {(post.song?.poster_url || post.karaoke?.poster_url) ? (
                    <img src={post.song?.poster_url || post.karaoke?.poster_url} alt="" className="feed-song-art" />
                  ) : null}
                  <div className="feed-song-copy">
                    <h3>{post.title}</h3>
                    <p>{post.song?.title || post.karaoke?.title} - {post.song?.artist || post.karaoke?.artist}</p>
                  </div>
                </div>

                {post.caption ? <p className="feed-caption">{post.caption}</p> : null}

                <audio controls src={post.audioUrl} className="feed-recording-audio"></audio>

                <div className="feed-actions" role="group" aria-label="Post actions">
                  <button
                    type="button"
                    className={`feed-action ${post.isLiked ? 'is-liked' : ''}`}
                    onClick={() => handleLike(post._id)}
                    aria-label={post.isLiked ? 'Unlike this post' : 'Like this post'}
                  >
                    <i className={`fa-${post.isLiked ? 'solid' : 'regular'} fa-heart`} aria-hidden="true"></i>
                    <span>{post.likesCount || 0}</span>
                  </button>

                  <button
                    type="button"
                    className="feed-action"
                    onClick={() => openComments(post._id)}
                    aria-label="Open comments"
                  >
                    <i className="fa-regular fa-comment" aria-hidden="true"></i>
                    <span>{post.commentsCount || 0}</span>
                  </button>

                  <button
                    type="button"
                    className="feed-action"
                    onClick={() => sharePost(post)}
                    aria-label="Share this post"
                  >
                    <i className="fa-solid fa-share-nodes" aria-hidden="true"></i>
                    <span>Share</span>
                  </button>
                </div>
              </article>
            ))}

            {hasMore ? (
              <button
                type="button"
                className="music-outline-btn feed-load-more"
                disabled={loadingMore}
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  fetchPosts(next);
                }}
              >
                {loadingMore ? 'Loading...' : 'Load more posts'}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <AppDialog
        open={Boolean(commentingPostId)}
        title="Comments"
        onClose={() => {
          setCommentingPostId('');
          setComments([]);
          setCommentText('');
          setCommentsError('');
        }}
        labelledBy="feed-comments-dialog-title"
        width="620px"
      >
        <div className="feed-comments-dialog">
          {activePost ? (
            <p className="feed-comments-context">
              {activePost.author?.name} • {activePost.title}
            </p>
          ) : null}

          {commentsLoading ? <p className="feed-comments-status" role="status">Loading comments...</p> : null}
          {commentsError ? <p className="feed-comments-status feed-status-error" role="alert">{commentsError}</p> : null}

          {!commentsLoading && !commentsError && comments.length === 0 ? (
            <p className="feed-comments-status" role="status">No comments yet. Be the first to comment.</p>
          ) : null}

          {comments.length > 0 ? (
            <ul className="feed-comments-list" aria-label="Comments">
              {comments.map((comment) => (
                <li key={comment._id} className="feed-comment-item">
                  <Link to={`/user/${comment.author?._id}`} className="feed-comment-author" onClick={() => setCommentingPostId('')}>
                    <span className="feed-comment-avatar" aria-hidden="true">
                      {comment.author?.avatar ? <img src={comment.author.avatar} alt="" /> : comment.author?.name?.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{comment.author?.name}</strong>
                      <small>{formatTimeAgo(comment.createdAt)}</small>
                    </span>
                  </Link>
                  <p>{comment.text}</p>
                  {(user?.id === comment.author?._id || user?.role === 'admin') ? (
                    <button
                      type="button"
                      className="feed-comment-delete"
                      onClick={() => deleteComment(comment._id)}
                      aria-label="Delete comment"
                    >
                      <i className="fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <form
            className="feed-comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              submitComment();
            }}
          >
            <label htmlFor="feed-comment-input">Add comment</label>
            <div className="feed-comment-input-row">
              <input
                id="feed-comment-input"
                type="text"
                maxLength={500}
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Write a comment"
              />
              <button type="submit" className="music-pill-btn" disabled={!commentText.trim() || submittingComment}>
                {submittingComment ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </AppDialog>

      <AppDialog
        open={Boolean(manualShareText)}
        title="Share post"
        onClose={() => setManualShareText('')}
        labelledBy="feed-share-dialog-title"
      >
        <div className="feed-share-dialog">
          <p>Copy this text to share:</p>
          <textarea value={manualShareText} readOnly rows={5}></textarea>
        </div>
      </AppDialog>
    </div>
  );
}
