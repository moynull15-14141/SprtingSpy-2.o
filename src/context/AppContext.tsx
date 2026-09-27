/**
 * SportingSpy Central Application State & Navigation Context
 * Provides reactive access to sports, events, editions, articles, authors,
 * comments, media library, ad slot configuration, theme, and authenticated user.
 * Integrates directly with the full-stack server API (/api/*) for real persistence and RBAC.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  INITIAL_AD_SLOTS,
  INITIAL_ARTICLES,
  INITIAL_AUTHORS,
  INITIAL_COMMENTS,
  INITIAL_EDITIONS,
  INITIAL_EVENTS,
  INITIAL_MEDIA_ITEMS,
  INITIAL_REDIRECT_RULES,
  INITIAL_SPORTS,
} from '../data/seedData';
import {
  AdSlotConfig,
  AdSlotId,
  Article,
  AuditLog,
  Author,
  Comment,
  EventEdition,
  MediaItem,
  RedirectRule,
  Role,
  SafeUser,
  Sport,
  SportEvent,
  User,
  UserStatus,
} from '../types';

/** A safe placeholder shown to logged-out visitors so components that read currentUser.role/.avatar/.name don't need a null check everywhere. It carries no real identity and the server never treats it as authenticated. */
const GUEST_READER: SafeUser = {
  id: 'guest-reader',
  name: 'Guest',
  email: '',
  role: 'Reader',
  avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&h=120&q=80',
  joinedAt: new Date(0).toISOString(),
};

export interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AppContextType {
  // Theme
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  accountLanguage: 'en' | 'bn';
  setAccountLanguage: (language: 'en' | 'bn') => void;

  // Routing
  currentPath: string;
  navigate: (path: string) => void;

  // PHASE 1: real authentication. `currentUser` is a derived, always-present
  // display value (GUEST_READER when logged out) so existing components can
  // keep reading currentUser.role/.avatar/.name without null checks — but it
  // is NOT the source of truth for security. `authUser` (null when logged
  // out) and `isAuthenticated` are the real signal; every mutation is
  // enforced server-side against the session cookie regardless of what this
  // client-side state says.
  currentUser: SafeUser;
  authUser: SafeUser | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<boolean>;
  apiCall: <T>(endpoint: string, options?: { method?: string; body?: unknown }) => Promise<{ data: T | null; error: string | null; status?: number }>;
  updateAccountIdentity: (user: SafeUser) => void;
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
  addArticle: (article: Omit<Article, 'id' | 'publishedAt'>) => Promise<boolean>;
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
  addMediaItem: (item: Omit<MediaItem, 'id' | 'uploadedAt'>) => Promise<boolean>;
  updateMediaItem: (id: string, updates: Partial<MediaItem>) => Promise<boolean>;
  deleteMediaItem: (id: string) => Promise<boolean>;

  // Ads
  toggleAdSlot: (slotId: AdSlotId, enabled?: boolean) => void;
  updateAdSlot: (slotId: AdSlotId, updates: Partial<AdSlotConfig>) => Promise<boolean>;

  // Notifications
  notification: AppNotification | null;
  showNotification: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearNotification: () => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedSportFilter: string;
  setSelectedSportFilter: (sportSlug: string) => void;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accountLanguage, setAccountLanguage] = useState<'en' | 'bn'>(() => localStorage.getItem('sportingspy_account_language') === 'bn' ? 'bn' : 'en');
  useEffect(() => { localStorage.setItem('sportingspy_account_language', accountLanguage); }, [accountLanguage]);
  const authGeneration = useRef(0);
  const dataGeneration = useRef(0);
  // Theme setup with localStorage persistence
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sportingspy_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('sportingspy_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const [notification, setNotification] = useState<AppNotification | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ id: `notif-${Date.now()}`, message, type });
    setTimeout(() => {
      setNotification((curr) => (curr && curr.message === message ? null : curr));
    }, 4500);
  };

  const clearNotification = () => setNotification(null);

  const [redirectRules, setRedirectRules] = useState<RedirectRule[]>(INITIAL_REDIRECT_RULES);

  // URL-synchronized client-side router with 301/302 redirect engine
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const rawPath = window.location.pathname || '/';
      const path = rawPath.endsWith('/') && rawPath.length > 1 ? rawPath.slice(0, -1) : rawPath;
      const matched = INITIAL_REDIRECT_RULES.find((r) => r.isActive && r.sourceUrl === path);
      return matched ? matched.targetUrl : path;
    }
    return '/';
  });

  const navigate = (path: string) => {
    const raw = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
    const activeRule = redirectRules.find((r) => r.isActive && r.sourceUrl === raw);
    const destination = activeRule ? activeRule.targetUrl : raw;

    if (typeof window !== 'undefined') {
      if (activeRule) {
        window.history.replaceState({}, '', destination);
      } else {
        window.history.pushState({}, '', destination);
      }
    }
    setCurrentPath(destination);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const onPopState = () => {
      const raw = window.location.pathname || '/';
      const path = raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw;
      const matched = redirectRules.find((r) => r.isActive && r.sourceUrl === path);
      if (matched) {
        window.history.replaceState({}, '', matched.targetUrl);
        setCurrentPath(matched.targetUrl);
      } else {
        setCurrentPath(path);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [redirectRules]);

  // Data collections initialized from authoritative seed data
  const [sports, setSports] = useState<Sport[]>(INITIAL_SPORTS);
  const [events, setEvents] = useState<SportEvent[]>(INITIAL_EVENTS);
  const [editions, setEditions] = useState<EventEdition[]>(INITIAL_EDITIONS);
  const [articles, setArticles] = useState<Article[]>(INITIAL_ARTICLES.filter(a => a.status === 'published'));
  const [authors, setAuthors] = useState<Author[]>(INITIAL_AUTHORS);
  const [users, setUsers] = useState<User[]>([]);
  const [comments, setComments] = useState<Comment[]>(INITIAL_COMMENTS.filter(c => c.status === 'approved'));
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(INITIAL_MEDIA_ITEMS);
  const [adSlots, setAdSlots] = useState<AdSlotConfig[]>(INITIAL_AD_SLOTS);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // PHASE 1: real authenticated identity, resolved from the server's session
  // cookie via GET /api/auth/me — never stored in localStorage, never
  // client-decided. `authUser` is null until that check resolves (or the
  // visitor isn't logged in). `currentUser` below is a derived display
  // convenience, not a security signal.
  const [authUser, setAuthUser] = useState<SafeUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const currentUser: SafeUser = authUser || GUEST_READER;
  const isAuthenticated = authUser !== null;
  const clearPrivateData = () => {
    authGeneration.current++;
    dataGeneration.current++;
    setAuthUser(null);
    setUsers([]);
    setAuditLogs([]);
    setArticles(previous => previous.filter(a => a.status === 'published'));
    setComments(previous => previous.filter(c => c.status === 'approved'));
    setNotification(null);
  };
  const updateAccountIdentity = (user: SafeUser) => { setAuthUser(user); };

  // Reads the CSRF token cookie the server sets on every request (see
  // server/csrf.ts). It is deliberately NOT HttpOnly so this same-origin
  // frontend can read it and echo it back — a cross-site attacker's page
  // cannot read this cookie's value due to same-origin cookie restrictions,
  // which is exactly what makes the double-submit pattern work.
  const readCsrfCookie = (): string | undefined => {
    if (typeof document === 'undefined') return undefined;
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  };

  // API Client Helper.
  // PHASE 0.1 removed trust in client-supplied x-user-id/x-user-role
  // headers. PHASE 1 removes the dev-token placeholder entirely: identity
  // now travels via an HttpOnly session cookie the browser can't read or
  // forge, sent automatically by the browser on same-origin requests as
  // long as `credentials: 'include'` is set — no header this code writes
  // has any bearing on who the server thinks is making the request.
  // PHASE 3: mutating requests also echo the csrf_token cookie back as an
  // `x-csrf-token` header — required by server/csrf.ts's double-submit CSRF
  // check for every POST/PUT/PATCH/DELETE.
  const apiCall = async <T,>(
    endpoint: string,
    options: {
      method?: string;
      body?: unknown;
    } = {}
  ): Promise<{ data: T | null; error: string | null; status?: number }> => {
    const generation = authGeneration.current;
    try {
      const method = options.method || 'GET';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (method !== 'GET' && method !== 'HEAD') {
        const csrfToken = readCsrfCookie();
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
      }

      const res = await fetch(endpoint, {
        method,
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (!res.ok) {
        if (res.status === 401 && endpoint !== '/api/auth/login' && generation === authGeneration.current) clearPrivateData();
        const errorJson = await res.json().catch(() => ({ error: `Server error: ${res.status} ${res.statusText}` }));
        const errorMessage = errorJson.error || `HTTP ${res.status}`;
        if (res.status !== 401) {
          // 401s happen routinely for logged-out visitors browsing normally
          // (e.g. GET /api/auth/me) — surfacing a toast for every one of
          // those would be noisy and misleading, so only genuine failures
          // on actions the user actively took are announced.
          showNotification(errorMessage, 'error');
        }
        return { data: null, error: errorMessage, status: res.status };
      }

      const json = await res.json();
      if (generation !== authGeneration.current) return { data: null, error: 'Session changed. Please try again.' };
      return { data: json as T, error: null, status: res.status };
    } catch (err: unknown) {
      console.warn(`[API] Failed to fetch from ${endpoint}:`, err);
      return { data: null, error: 'Network failure' };
    }
  };

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const res = await apiCall<{ user: SafeUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (res.data?.user) {
      clearPrivateData();
      setAuthUser(res.data.user);
      showNotification(`Welcome back, ${res.data.user.name}.`, 'success');
      return { success: true };
    }
    return { success: false, error: res.error || 'Login failed.' };
  };

  const logout = async (): Promise<boolean> => {
    const result = await apiCall<{ success: boolean }>('/api/auth/logout', { method: 'POST', body: {} });
    if (!result.data?.success) {
      showNotification('Logout could not be completed. Please try again.', 'error');
      return false;
    }
    clearPrivateData();
    localStorage.setItem('sportingspy_logout', String(Date.now()));
    showNotification('Logged out.', 'info');
    navigate('/');
    return true;
  };

  // On first mount, ask the server who (if anyone) this browser is
  // currently logged in as. This is the ONLY place client-side auth state
  // is established — never from localStorage, never assumed.
  useEffect(() => {
    (async () => {
      const generation = authGeneration.current;
      const res = await apiCall<{ user: SafeUser }>('/api/auth/me');
      if (generation === authGeneration.current) setAuthUser(res.data?.user || null);
      setAuthLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === 'sportingspy_logout') clearPrivateData(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const recheck = async () => {
      const generation = authGeneration.current;
      const result = await apiCall<{ user: SafeUser }>('/api/auth/me');
      if (result.data && generation === authGeneration.current) {
        if (result.data.user.role !== authUser.role) clearPrivateData();
        setAuthUser(result.data.user);
      }
    };
    window.addEventListener('focus', recheck);
    const timer = window.setInterval(recheck, 60_000);
    return () => { window.removeEventListener('focus', recheck); window.clearInterval(timer); };
  }, [authUser?.id, authUser?.role]);

  // Synchronize state with persistent backend API
  const refreshData = async () => {
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
    }>('/api/data');

    if (res.data && generation === authGeneration.current && request === dataGeneration.current) {
      if (res.data.sports) setSports(res.data.sports);
      if (res.data.events) setEvents(res.data.events);
      if (res.data.editions) setEditions(res.data.editions);
      if (res.data.articles) setArticles(res.data.articles);
      if (res.data.authors) setAuthors(res.data.authors);
      if (res.data.users) setUsers(res.data.users);
      if (res.data.comments) setComments(res.data.comments);
      if (res.data.mediaItems) setMediaItems(res.data.mediaItems);
      if (res.data.adSlots) setAdSlots(res.data.adSlots);
      if (res.data.auditLogs) setAuditLogs(res.data.auditLogs);
      if (res.data.redirectRules) setRedirectRules(res.data.redirectRules);
    }
  };

  // Initial data load + re-sync whenever auth state changes (login/logout
  // changes which articles/preview content the server will include).
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

  const addArticle = async (newArticle: Omit<Article, 'id' | 'publishedAt'>): Promise<boolean> => {
    const res = await apiCall<Article>('/api/articles', {
      method: 'POST',
      body: newArticle,
    });
    if (res.data) {
      setArticles((prev) => [res.data!, ...prev]);
      showNotification(`Article "${newArticle.title}" created (${newArticle.status}).`, 'success');
      refreshData();
      return true;
    }
    return false;
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

  const addMediaItem = async (item: Omit<MediaItem, 'id' | 'uploadedAt'>): Promise<boolean> => {
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
        theme,
        toggleTheme,
        accountLanguage,
        setAccountLanguage,
        apiCall,
        updateAccountIdentity,
        currentPath,
        navigate,
        currentUser,
        authUser,
        isAuthenticated,
        authLoading,
        login,
        logout,
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
        notification,
        showNotification,
        clearNotification,
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

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
