'use client';

/**
 * SportingSpy CMS data context (admin only).
 *
 * PHASE B: this used to be the whole application's state, hydrated from a
 * full-database GET /api/data on every page. Public pages now render on the
 * server with route-specific queries; this provider is mounted only under
 * /admin and loads the CMS dataset from the staff-only GET /api/cms/data.
 * Theme, session, notifications and navigation come from SiteContext.
 * Every mutation below is still authorized server-side.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AdSlotConfig,
  AdSlotId,
  Article,
  AuditLog,
  Author,
  Comment,
  EventEdition,
  FeatureFlags,
  MediaItem,
  MediaUsage,
  RedirectRule,
  Role,
  Sport,
  SportEvent,
  User,
  UserStatus,
} from '../types';
import { useSite, type SiteContextType } from './SiteContext';

const STAFF_ROLES = ['Admin', 'Editor', 'Author'];

interface AdminDataContextType {
  users: User[];

  // Core Data
  sports: Sport[];
  events: SportEvent[];
  editions: EventEdition[];
  articles: Article[];
  authors: Author[];
  comments: Comment[];
  mediaItems: MediaItem[];
  adSlots: AdSlotConfig[];
  auditLogs: AuditLog[];
  redirectRules: RedirectRule[];
  /** PHASE C: where each media item is used (by media id). */
  mediaUsage: Record<string, MediaUsage[]>;

  // Actions for Editorial CMS
  addSport: (sport: Omit<Sport, 'id'>) => Promise<boolean>;
  updateSport: (id: string, updates: Partial<Sport>) => Promise<boolean>;
  deleteSport: (id: string) => Promise<boolean>;
  addEvent: (event: Omit<SportEvent, 'id'>) => Promise<boolean>;
  updateEvent: (id: string, updates: Partial<SportEvent>) => Promise<boolean>;
  deleteEvent: (id: string) => Promise<boolean>;
  addEdition: (edition: Omit<EventEdition, 'id'>) => Promise<boolean>;
  updateEdition: (id: string, updates: Partial<EventEdition>) => Promise<boolean>;
  deleteEdition: (id: string) => Promise<boolean>;
  addArticle: (article: Omit<Article, 'id' | 'publishedAt' | 'content'> & { content?: string }) => Promise<Article | null>;
  updateArticle: (id: string, updates: Partial<Article>) => Promise<boolean>;
  deleteArticle: (id: string) => Promise<boolean>;

  // Authors & Users
  addAuthor: (author: Omit<Author, 'id'>) => Promise<boolean>;
  updateAuthor: (id: string, updates: Partial<Author>) => Promise<boolean>;
  // PHASE 1: createStaffUser persists to data/db.json via POST /api/users
  // (password is hashed server-side, never stored or returned in plaintext).
  // This replaces the old addUser(), which only ever updated local React
  // state and silently discarded everything on refresh.
  createStaffUser: (user: { name: string; email: string; role: Role; password: string }) => Promise<boolean>;
  updateUserRole: (id: string, role: Role) => Promise<boolean>;
  updateUserStatus: (id: string, status: UserStatus) => Promise<boolean>;
  deleteStaffUser: (id: string) => Promise<boolean>;

  // Redirect Rules
  addRedirectRule: (rule: Omit<RedirectRule, 'id' | 'createdAt'>) => Promise<boolean>;
  toggleRedirectRule: (id: string) => Promise<boolean>;
  deleteRedirectRule: (id: string) => Promise<boolean>;

  // Comments
  addComment: (articleId: string, content: string) => Promise<boolean>;
  moderateComment: (id: string, status: 'approved' | 'rejected') => Promise<boolean>;
  deleteComment: (id: string) => Promise<boolean>;

  // Media
  addMediaItem: (item: Omit<MediaItem, 'id' | 'uploadedAt' | 'copyrightReview'>) => Promise<boolean>;
  /** PHASE C: multipart upload to the Media Library; returns the new item. */
  uploadMedia: (file: File, metadata: Record<string, string>) => Promise<MediaItem | null>;
  updateMediaItem: (id: string, updates: Partial<MediaItem>) => Promise<boolean>;
  deleteMediaItem: (id: string) => Promise<boolean>;

  // Ads
  toggleAdSlot: (slotId: AdSlotId, enabled?: boolean) => void;
  updateAdSlot: (slotId: AdSlotId, updates: Partial<AdSlotConfig>) => Promise<boolean>;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedSportFilter: string;
  setSelectedSportFilter: (sportSlug: string) => void;
  refreshData: () => Promise<void>;
}

type AppContextType = SiteContextType & AdminDataContextType;

const AppContext = createContext<AdminDataContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authUser, authLoading, authEpoch, authGeneration, apiCall, showNotification } = useSite();
  const dataGeneration = useRef(0);

  const [redirectRules, setRedirectRules] = useState<RedirectRule[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [events, setEvents] = useState<SportEvent[]>([]);
  const [editions, setEditions] = useState<EventEdition[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [adSlots, setAdSlots] = useState<AdSlotConfig[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [mediaUsage, setMediaUsage] = useState<Record<string, MediaUsage[]>>({});

  // Discard everything private whenever the session ends or changes.
  useEffect(() => {
    dataGeneration.current++;
    setUsers([]);
    setAuditLogs([]);
    setArticles([]);
    setComments([]);
  }, [authEpoch]);

  const isStaff = !!authUser && STAFF_ROLES.includes(authUser.role);

  const refreshData = async () => {
    if (!isStaff) return;
    const generation = authGeneration.current;
    const request = ++dataGeneration.current;
    const res = await apiCall<{
      sports: Sport[];
      events: SportEvent[];
      editions: EventEdition[];
      articles: Article[];
      authors: Author[];
      users: User[];
      comments: Comment[];
      mediaItems: MediaItem[];
      adSlots: AdSlotConfig[];
      auditLogs: AuditLog[];
      redirectRules: RedirectRule[];
      features: FeatureFlags;
      mediaUsage: Record<string, MediaUsage[]>;
    }>('/api/cms/data');

    if (res.data && generation === authGeneration.current && request === dataGeneration.current) {
      setSports(res.data.sports);
      setEvents(res.data.events);
      setEditions(res.data.editions);
      setArticles(res.data.articles);
      setAuthors(res.data.authors);
      setUsers(res.data.users);
      setComments(res.data.comments);
      setMediaItems(res.data.mediaItems);
      setAdSlots(res.data.adSlots);
      setAuditLogs(res.data.auditLogs);
      setRedirectRules(res.data.redirectRules);
      setMediaUsage(res.data.mediaUsage || {});
    }
  };

  // Load once the session is known, and again whenever the identity changes.
  useEffect(() => {
    if (authLoading) return;
    refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, authUser?.id, authUser?.role]);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSportFilter, setSelectedSportFilter] = useState('');

  // CMS Handlers
  const addSport = async (newSport: Omit<Sport, 'id'>): Promise<boolean> => {
    const res = await apiCall<Sport>('/api/sports', {
      method: 'POST',
      body: newSport,
    });
    if (res.data) {
      setSports((prev) => [...prev, res.data!]);
      showNotification(`Sport "${newSport.name}" created successfully.`, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const updateSport = async (id: string, updates: Partial<Sport>): Promise<boolean> => {
    const res = await apiCall<Sport>(`/api/sports/${id}`, {
      method: 'PUT',
      body: updates,
    });
    if (res.data) {
      setSports((prev) => prev.map((s) => (s.id === id ? res.data! : s)));
      showNotification('Sport updated successfully.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteSport = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/sports/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setSports((prev) => prev.filter((s) => s.id !== id));
      showNotification('Sport deleted successfully.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const addEvent = async (newEvent: Omit<SportEvent, 'id'>): Promise<boolean> => {
    const res = await apiCall<SportEvent>('/api/events', {
      method: 'POST',
      body: newEvent,
    });
    if (res.data) {
      setEvents((prev) => [...prev, res.data!]);
      showNotification(`Permanent Event "${newEvent.name}" created.`, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const updateEvent = async (id: string, updates: Partial<SportEvent>): Promise<boolean> => {
    const res = await apiCall<SportEvent>(`/api/events/${id}`, {
      method: 'PUT',
      body: updates,
    });
    if (res.data) {
      setEvents((prev) => prev.map((e) => (e.id === id ? res.data! : e)));
      showNotification('Permanent event updated.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteEvent = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/events/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setEvents((prev) => prev.filter((e) => e.id !== id));
      showNotification('Event deleted.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const addEdition = async (newEdition: Omit<EventEdition, 'id'>): Promise<boolean> => {
    const res = await apiCall<EventEdition>('/api/editions', {
      method: 'POST',
      body: newEdition,
    });
    if (res.data) {
      setEditions((prev) => [res.data!, ...prev]);
      showNotification(`Event Edition "${newEdition.title}" created.`, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const updateEdition = async (id: string, updates: Partial<EventEdition>): Promise<boolean> => {
    const res = await apiCall<EventEdition>(`/api/editions/${id}`, {
      method: 'PUT',
      body: updates,
    });
    if (res.data) {
      setEditions((prev) => prev.map((ed) => (ed.id === id ? res.data! : ed)));
      showNotification('Edition updated.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteEdition = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/editions/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setEditions((prev) => prev.filter((ed) => ed.id !== id));
      showNotification('Edition deleted.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const addArticle = async (newArticle: Omit<Article, 'id' | 'publishedAt' | 'content'> & { content?: string }): Promise<Article | null> => {
    const res = await apiCall<Article>('/api/articles', {
      method: 'POST',
      body: newArticle,
    });
    if (res.data) {
      setArticles((prev) => [res.data!, ...prev]);
      showNotification(`Article "${newArticle.title}" created (${newArticle.status}).`, 'success');
      refreshData();
      return res.data;
    }
    return null;
  };

  const updateArticle = async (id: string, updates: Partial<Article>): Promise<boolean> => {
    const res = await apiCall<Article>(`/api/articles/${id}`, {
      method: 'PUT',
      body: updates,
    });
    if (res.data) {
      setArticles((prev) => prev.map((a) => (a.id === id ? res.data! : a)));
      showNotification('Article updated successfully.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteArticle = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/articles/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setArticles((prev) => prev.filter((a) => a.id !== id));
      showNotification('Article deleted.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const addAuthor = async (newAuthor: Omit<Author, 'id'>): Promise<boolean> => {
    const res = await apiCall<Author>('/api/authors', {
      method: 'POST',
      body: newAuthor,
    });
    if (res.data) {
      setAuthors((prev) => [...prev, res.data!]);
      showNotification(`Author profile "${newAuthor.name}" created.`, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const updateAuthor = async (id: string, updates: Partial<Author>): Promise<boolean> => {
    const res = await apiCall<Author>(`/api/authors/${id}`, {
      method: 'PUT',
      body: updates,
    });
    if (res.data) {
      setAuthors((prev) => prev.map((a) => (a.id === id ? res.data! : a)));
      showNotification('Author profile updated.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const createStaffUser = async (newUser: { name: string; email: string; role: Role; password: string }): Promise<boolean> => {
    const res = await apiCall<User>('/api/users', {
      method: 'POST',
      body: newUser,
    });
    if (res.data) {
      setUsers((prev) => [...prev, res.data!]);
      showNotification(`Staff account "${newUser.name}" created.`, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const updateUserRole = async (id: string, role: Role): Promise<boolean> => {
    const res = await apiCall<User>(`/api/users/${id}/role`, {
      method: 'PUT',
      body: { role },
    });
    if (res.data) {
      setUsers((prev) => prev.map((u) => (u.id === id ? res.data! : u)));
      showNotification(`User role updated to ${role}.`, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const updateUserStatus = async (id: string, status: UserStatus): Promise<boolean> => {
    const res = await apiCall<User>(`/api/users/${id}/status`, {
      method: 'PUT',
      body: { status },
    });
    if (res.data) {
      setUsers((prev) => prev.map((u) => (u.id === id ? res.data! : u)));
      showNotification(`User ${status === 'active' ? 'reactivated' : 'deactivated'}.`, 'info');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteStaffUser = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/users/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
      showNotification('Staff account deleted.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const addRedirectRule = async (rule: Omit<RedirectRule, 'id' | 'createdAt'>): Promise<boolean> => {
    const res = await apiCall<RedirectRule>('/api/redirects', {
      method: 'POST',
      body: rule,
    });
    if (res.data) {
      setRedirectRules((prev) => [res.data!, ...prev]);
      showNotification(`Redirect rule created: ${rule.sourceUrl} -> ${rule.targetUrl}`, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const toggleRedirectRule = async (id: string): Promise<boolean> => {
    const current = redirectRules.find((r) => r.id === id);
    if (!current) return false;
    const res = await apiCall<RedirectRule>(`/api/redirects/${id}`, {
      method: 'PUT',
      body: { isActive: !current.isActive },
    });
    if (res.data) {
      setRedirectRules((prev) => prev.map((r) => (r.id === id ? res.data! : r)));
      showNotification(`Redirect rule ${res.data.isActive ? 'enabled' : 'disabled'}.`, 'info');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteRedirectRule = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/redirects/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setRedirectRules((prev) => prev.filter((r) => r.id !== id));
      showNotification('Redirect rule deleted.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const addComment = async (articleId: string, content: string): Promise<boolean> => {
    const res = await apiCall<Comment>('/api/comments', {
      method: 'POST',
      body: { articleId, content },
    });
    if (res.data) {
      setComments((prev) => [res.data!, ...prev]);
      const statusNotice = res.data.status === 'approved' ? 'Comment published.' : 'Comment submitted for editorial review.';
      showNotification(statusNotice, 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const moderateComment = async (id: string, status: 'approved' | 'rejected'): Promise<boolean> => {
    const res = await apiCall<Comment>(`/api/comments/${id}`, {
      method: 'PUT',
      body: { status },
    });
    if (res.data) {
      setComments((prev) => prev.map((c) => (c.id === id ? res.data! : c)));
      showNotification(`Comment marked as ${status}.`, 'info');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteComment = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/comments/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setComments((prev) => prev.filter((c) => c.id !== id));
      showNotification('Comment deleted.', 'info');
      refreshData();
      return true;
    }
    return false;
  };

  const uploadMedia = async (file: File, metadata: Record<string, string>): Promise<MediaItem | null> => {
    const form = new FormData();
    for (const [key, value] of Object.entries(metadata)) if (value) form.append(key, value);
    form.append('file', file);
    const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {},
      });
      const json = await res.json().catch(() => ({ error: `Upload failed (HTTP ${res.status}).` }));
      if (!res.ok) {
        showNotification(json.error || 'Upload failed.', 'error');
        return null;
      }
      setMediaItems((prev) => [json as MediaItem, ...prev]);
      showNotification(`Uploaded "${(json as MediaItem).title}".`, 'success');
      refreshData();
      return json as MediaItem;
    } catch {
      showNotification('Upload failed: network error.', 'error');
      return null;
    }
  };

  const addMediaItem = async (item: Omit<MediaItem, 'id' | 'uploadedAt' | 'copyrightReview'>): Promise<boolean> => {
    const res = await apiCall<MediaItem>('/api/media', {
      method: 'POST',
      body: item,
    });
    if (res.data) {
      setMediaItems((prev) => [res.data!, ...prev]);
      showNotification('Media asset added to library.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const updateMediaItem = async (id: string, updates: Partial<MediaItem>): Promise<boolean> => {
    const res = await apiCall<MediaItem>(`/api/media/${id}`, {
      method: 'PUT',
      body: updates,
    });
    if (res.data) {
      setMediaItems((prev) => prev.map((m) => (m.id === id ? res.data! : m)));
      showNotification('Media asset metadata updated.', 'success');
      refreshData();
      return true;
    }
    return false;
  };

  const deleteMediaItem = async (id: string): Promise<boolean> => {
    const res = await apiCall<{ success: boolean }>(`/api/media/${id}`, {
      method: 'DELETE',
    });
    if (res.data && res.data.success) {
      setMediaItems((prev) => prev.filter((m) => m.id !== id));
      showNotification('Media asset removed.', 'info');
      refreshData();
      return true;
    }
    return false;
  };

  const toggleAdSlot = (slotId: AdSlotId, enabled?: boolean) => {
    const current = adSlots.find((s) => s.id === slotId);
    if (!current) return;
    const nextState = enabled !== undefined ? enabled : !current.enabled;
    updateAdSlot(slotId, { enabled: nextState });
  };

  const updateAdSlot = async (slotId: AdSlotId, updates: Partial<AdSlotConfig>): Promise<boolean> => {
    const res = await apiCall<AdSlotConfig>(`/api/ads/${slotId}`, {
      method: 'PUT',
      body: updates,
    });
    if (res.data) {
      setAdSlots((prev) => prev.map((slot) => (slot.id === slotId ? res.data! : slot)));
      showNotification(`Ad slot ${slotId} updated.`, 'info');
      refreshData();
      return true;
    }
    return false;
  };

  return (
    <AppContext.Provider
      value={{
        users,
        sports,
        events,
        editions,
        articles,
        authors,
        comments,
        mediaItems,
        adSlots,
        auditLogs,
        redirectRules,
        mediaUsage,
        uploadMedia,
        addSport,
        updateSport,
        deleteSport,
        addEvent,
        updateEvent,
        deleteEvent,
        addEdition,
        updateEdition,
        deleteEdition,
        addArticle,
        updateArticle,
        deleteArticle,
        addAuthor,
        updateAuthor,
        createStaffUser,
        updateUserRole,
        updateUserStatus,
        deleteStaffUser,
        addRedirectRule,
        toggleRedirectRule,
        deleteRedirectRule,
        addComment,
        moderateComment,
        deleteComment,
        addMediaItem,
        updateMediaItem,
        deleteMediaItem,
        toggleAdSlot,
        updateAdSlot,
        searchQuery,
        setSearchQuery,
        selectedSportFilter,
        setSelectedSportFilter,
        refreshData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

/** CMS components read both the site context (session, theme, navigation) and the CMS data. */
export function useApp(): AppContextType {
  const site = useSite();
  const data = useContext(AppContext);
  if (!data) throw new Error('useApp must be used within an AppProvider');
  return { ...site, ...data };
}
