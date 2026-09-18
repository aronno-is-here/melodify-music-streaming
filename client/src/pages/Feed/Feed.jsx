import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './Feed.css?raw';

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
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [commentingPost, setCommentingPost] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchPosts = useCallback(async (pageNum = 1) => {
    if (pageNum === 1) setLoading(true);
    const data = await api.get(`/api/posts?page=${pageNum}&limit=20`);
    if (data.success) {
      if (pageNum === 1) {
        setPosts(data.posts);
      } else {
        setPosts((prev) => [...prev, ...data.posts]);
      }
      setHasMore(pageNum < data.pages);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPosts(1); }, [fetchPosts]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPosts(next);
  };

  const handleLike = async (postId) => {
    const post = posts.find((p) => p._id === postId);
    if (!post) return;

    setPosts((prev) =>
      prev.map((p) =>
        p._id === postId
          ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 }
          : p
      )
    );

    if (post.isLiked) {
      await api.del(`/api/likes/${postId}`);
    } else {
      await api.post(`/api/likes/${postId}`);
    }
  };

  const openComments = async (postId) => {
    setCommentingPost(postId);
    setCommentText('');
    setCommentsLoading(true);
    const data = await api.get(`/api/comments/${postId}`);
    if (data.success) setComments(data.comments);
    else setComments([]);
    setCommentsLoading(false);
  };

  const submitComment = async () => {
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    const data = await api.post(`/api/comments/${commentingPost}`, { text: commentText.trim() });
    if (data.success) {
      setComments((prev) => [...prev, data.comment]);
      setPosts((prev) =>
        prev.map((p) =>
          p._id === commentingPost ? { ...p, commentsCount: (p.commentsCount || 0) + 1 } : p
        )
      );
      setCommentText('');
    }
    setSubmittingComment(false);
  };

  const deleteComment = async (commentId) => {
    const data = await api.del(`/api/comments/${commentId}`);
    if (data.success) {
      setComments((prev) => prev.filter((c) => c._id !== commentId));
      setPosts((prev) =>
        prev.map((p) =>
          p._id === commentingPost ? { ...p, commentsCount: Math.max(0, (p.commentsCount || 0) - 1) } : p
        )
      );
    }
  };

  const sharePost = async (post) => {
    const shareUrl = `${window.location.origin}/user/${post.author?._id}`;
    const shareText = `Check out ${post.author?.name}'s karaoke performance of "${post.song?.title}" on Melodify!`;

    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, text: shareText, url: shareUrl });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        alert('Link copied to clipboard!');
      } catch {
        prompt('Copy this link:', `${shareText}\n${shareUrl}`);
      }
    }
  };

  const formatTimeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="feed-page">
      <header className="feed-header">
        <Link to="/dashboard" className="feed-back">
          <i className="fa-solid fa-chevron-left"></i>
          <span>Dashboard</span>
        </Link>
        <div className="feed-logo">
          MELOD<span>IFY</span> FEED
        </div>
      </header>

      <main className="feed-main">
        <div className="feed-container">
          <h1 className="feed-title">Community Feed</h1>
          <p className="feed-subtitle">Discover karaoke performances from the community</p>

          {loading && posts.length === 0 ? (
            <div className="feed-loading">Loading posts...</div>
          ) : posts.length === 0 ? (
            <div className="feed-empty">
              <i className="fa-solid fa-microphone-lines"></i>
              <h3>No posts yet</h3>
              <p>Be the first to share a karaoke performance!</p>
              <Link to="/studio" className="feed-cta">Go to Melodify Studio</Link>
            </div>
          ) : (
            <div className="feed-posts">
              {posts.map((post) => (
                <div key={post._id} className="feed-post">
                  <div className="feed-post-header">
                    <Link to={`/user/${post.author?._id}`} className="feed-post-author">
                      <div className="feed-post-avatar">
                        {post.author?.avatar ? (
                          <img src={post.author.avatar} alt={post.author.name} />
                        ) : (
                          post.author?.name?.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="feed-post-author-info">
                        <span className="feed-post-author-name">{post.author?.name}</span>
                        <span className="feed-post-time">{formatTimeAgo(post.createdAt)}</span>
                      </div>
                    </Link>
                  </div>

                  <div className="feed-post-song">
                    {post.song?.poster_url && (
                      <img className="feed-post-song-img" src={post.song.poster_url} alt="" />
                    )}
                    <div className="feed-post-song-info">
                      <span className="feed-post-song-title">{post.title}</span>
                      <span className="feed-post-song-name">{post.song?.title} - {post.song?.artist}</span>
                    </div>
                  </div>

                  {post.caption && <p className="feed-post-caption">{post.caption}</p>}

                  <audio controls src={post.audioUrl} className="feed-post-audio"></audio>

                  <div className="feed-post-actions">
                    <button
                      className={`feed-action-btn ${post.isLiked ? 'liked' : ''}`}
                      onClick={() => handleLike(post._id)}
                    >
                      <i className={`${post.isLiked ? 'fa-solid' : 'fa-regular'} fa-heart`}></i>
                      <span>{post.likesCount || 0}</span>
                    </button>
                    <button className="feed-action-btn" onClick={() => openComments(post._id)}>
                      <i className="fa-regular fa-comment"></i>
                      <span>{post.commentsCount || 0}</span>
                    </button>
                    <button className="feed-action-btn" onClick={() => sharePost(post)}>
                      <i className="fa-solid fa-share-nodes"></i>
                      <span>Share</span>
                    </button>
                  </div>
                </div>
              ))}

              {hasMore && (
                <button className="feed-load-more" onClick={loadMore}>
                  Load more posts
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      {commentingPost && (
        <div className="feed-modal-overlay" onClick={() => setCommentingPost(null)}>
          <div className="feed-modal" onClick={(e) => e.stopPropagation()}>
            <div className="feed-modal-header">
              <h3>Comments</h3>
              <button className="feed-modal-close" onClick={() => setCommentingPost(null)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="feed-modal-list">
              {commentsLoading ? (
                <div className="feed-modal-status">Loading comments...</div>
              ) : comments.length === 0 ? (
                <div className="feed-modal-status">No comments yet. Be the first!</div>
              ) : (
                comments.map((c) => (
                  <div key={c._id} className="feed-comment">
                    <Link to={`/user/${c.author?._id}`} className="feed-comment-avatar">
                      {c.author?.avatar ? (
                        <img src={c.author.avatar} alt={c.author.name} />
                      ) : (
                        c.author?.name?.charAt(0).toUpperCase()
                      )}
                    </Link>
                    <div className="feed-comment-body">
                      <div className="feed-comment-header">
                        <Link to={`/user/${c.author?._id}`} className="feed-comment-name">{c.author?.name}</Link>
                        <span className="feed-comment-time">{formatTimeAgo(c.createdAt)}</span>
                      </div>
                      <p className="feed-comment-text">{c.text}</p>
                    </div>
                    {(user?.id === c.author?._id || user?.role === 'admin') && (
                      <button className="feed-comment-delete" onClick={() => deleteComment(c._id)}>
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="feed-modal-input">
              <input
                type="text"
                placeholder="Write a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
              />
              <button onClick={submitComment} disabled={!commentText.trim() || submittingComment}>
                {submittingComment ? '...' : <i className="fa-solid fa-paper-plane"></i>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
