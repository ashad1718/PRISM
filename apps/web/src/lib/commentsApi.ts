export interface Comment {
  id: string;
  marketId: string;
  userId?: string | null;
  userName?: string | null;
  userPicture?: string | null;
  content?: string | null;
  text?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  authorAvatar?: string | null;
  createdAt: string | number;
  updatedAt?: string | number;
}

const getApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    let url = import.meta.env.VITE_API_URL.trim();
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    return url;
  }
  return '';
};

export async function fetchCommentsForMarket(marketId: string): Promise<Comment[]> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/markets/${encodeURIComponent(marketId)}/comments`;

  console.log("[COMMENTS] API BASE URL:", import.meta.env.VITE_API_URL);
  console.log("[COMMENTS] MARKET ID:", marketId);
  console.log("[COMMENTS] GET URL:", url);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    console.log("[COMMENTS] HTTP STATUS:", res.status);

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error("[COMMENTS] SERVER ERROR:", res.status, errorText);
      throw new Error(`Comments API returned HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log("[COMMENTS] RECEIVED DATA:", data);
    return Array.isArray(data.comments) ? data.comments : [];
  } catch (error: any) {
    console.error("[COMMENTS] REQUEST FAILED:", error);
    if (error?.name === 'TypeError' && error?.message === 'Failed to fetch') {
      throw new Error('Unable to connect to backend server at http://localhost:3000. Please ensure the backend server is running.');
    }
    throw error;
  }
}

export async function createCommentForMarket(
  marketId: string,
  content: string,
  token?: string
): Promise<Comment> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/markets/${encodeURIComponent(marketId)}/comments`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content,
      text: content,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Unable to post comment (HTTP ${res.status})`);
  }

  const data = await res.json();
  if (!data.comment) {
    throw new Error('Malformed response from backend server');
  }
  return data.comment;
}

export async function deleteCommentApi(commentId: string, token?: string): Promise<boolean> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/comments/${encodeURIComponent(commentId)}`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Unable to delete comment (HTTP ${res.status})`);
  }

  return true;
}

export interface CommentReport {
  reportId: string;
  commentId: string;
  reporterId: string;
  reason: string;
  reportedAt: string;
  marketId: string;
  commentText: string;
  authorId?: string | null;
  authorName?: string | null;
  authorAvatar?: string | null;
  commentCreatedAt: string;
  commentStatus: string;
  reportCount: number;
}

export async function reportCommentApi(
  commentId: string,
  reason: string,
  token?: string
): Promise<{ success: boolean; alreadyReported?: boolean; message?: string }> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/comments/${encodeURIComponent(commentId)}/report`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Unable to submit report (HTTP ${res.status})`);
  }

  return await res.json();
}

export async function fetchReportedCommentsAdmin(adminWallet: string): Promise<CommentReport[]> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/admin/comment-reports`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'x-admin-wallet': adminWallet,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Unable to fetch comment reports (HTTP ${res.status})`);
  }

  const data = await res.json();
  return Array.isArray(data.reports) ? data.reports : [];
}

export async function removeCommentAdmin(commentId: string, adminWallet: string): Promise<boolean> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/admin/comments/${encodeURIComponent(commentId)}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
      'x-admin-wallet': adminWallet,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Unable to remove comment (HTTP ${res.status})`);
  }

  return true;
}
