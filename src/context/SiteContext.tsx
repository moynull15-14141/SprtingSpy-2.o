'use client';

/**
 * SportingSpy site-wide client state (PHASE B).
 *
 * The small slice of browser state every page needs — theme, the staff
 * session (resolved from the server via /api/auth/me), CSRF-aware API calls,
 * notifications and navigation. Public pages render on the server and get
 * their data as props; the CMS dataset lives separately in AppContext,
 * which is mounted only under /admin.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { FeatureFlags, SafeUser } from '../types';
import { LEGACY_PAGE_REDIRECTS, canonicalPagePath, stripTrailingSlash } from '../config/urls';

/** A safe placeholder shown to logged-out visitors. It carries no real identity and the server never treats it as authenticated. */
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

export type ApiCall = <T>(endpoint: string, options?: { method?: string; body?: unknown }) => Promise<{ data: T | null; error: string | null; status?: number; details?: Record<string, unknown> }>;

export interface SiteContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  /** PHASE R UI/UX: the visitor's choice; "system" follows the operating system live. */
  themePreference: 'system' | 'light' | 'dark';
  setThemePreference: (preference: 'system' | 'light' | 'dark') => void;
  accountLanguage: 'en' | 'bn';
  setAccountLanguage: (language: 'en' | 'bn') => void;
  currentPath: string;
  navigate: (path: string) => void;
  currentUser: SafeUser;
  authUser: SafeUser | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<{ success: boolean; error?: string; totpRequired?: boolean }>;
  logout: () => Promise<boolean>;
  apiCall: ApiCall;
  updateAccountIdentity: (user: SafeUser) => void;
  /** Increments whenever private data must be discarded (logout, 401, identity change). */
  authEpoch: number;
  authGeneration: React.MutableRefObject<number>;
  features: FeatureFlags;
  notification: AppNotification | null;
  showNotification: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearNotification: () => void;
}

const SiteContext = createContext<SiteContextType | undefined>(undefined);

export const SiteProvider: React.FC<{ features: FeatureFlags; children: React.ReactNode }> = ({ features, children }) => {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const currentPath = stripTrailingSlash(pathname);
  const authGeneration = useRef(0);
  const [authEpoch, setAuthEpoch] = useState(0);

  // Browser preferences. Initial render matches the server; stored values
  // are applied after mount to avoid hydration mismatches. The theme class
  // itself is already on <html> before paint (inline script in app/layout).
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themePreference, setThemePreferenceState] = useState<'system' | 'light' | 'dark'>('system');
  const [storedLanguage, setAccountLanguage] = useState<'en' | 'bn'>('en');
  const prefsLoaded = useRef(false);
  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    try {
      const saved = localStorage.getItem('sportingspy_theme');
      if (saved === 'light' || saved === 'dark') setThemePreferenceState(saved);
    } catch { /* storage unavailable: system */ }
    try {
      if (localStorage.getItem('sportingspy_account_language') === 'bn') setAccountLanguage('bn');
    } catch { /* storage unavailable: keep defaults */ }
    prefsLoaded.current = true;
    // Without an explicit choice, follow the operating-system setting live.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('sportingspy_theme'); } catch { /* ignore */ }
      if (saved !== 'light' && saved !== 'dark') applyTheme(media.matches ? 'dark' : 'light', false);
    };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, []);
  // Only an explicit toggle is remembered; otherwise the system setting keeps applying.
  const applyTheme = (next: 'light' | 'dark', remember: boolean) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    setTheme(next);
    if (remember) try { localStorage.setItem('sportingspy_theme', next); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (prefsLoaded.current) try { localStorage.setItem('sportingspy_account_language', storedLanguage); } catch { /* ignore */ }
  }, [storedLanguage]);
  const toggleTheme = () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next, true);
    setThemePreferenceState(next);
  };
  const setThemePreference = (preference: 'system' | 'light' | 'dark') => {
    setThemePreferenceState(preference);
    if (preference !== 'system') { applyTheme(preference, true); return; }
    // Back to the operating-system setting: forget the explicit choice.
    try { localStorage.removeItem('sportingspy_theme'); } catch { /* ignore */ }
    applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', false);
  };

  const [notification, setNotification] = useState<AppNotification | null>(null);
  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ id: `notif-${Date.now()}`, message, type });
    setTimeout(() => setNotification((curr) => (curr && curr.message === message ? null : curr)), 4500);
  };
  const clearNotification = () => setNotification(null);

  // Server redirects are authoritative; this only avoids a visible bounce for
  // the known legacy URLs during client-side navigation.
  const navigate = (path: string) => {
    const raw = stripTrailingSlash(path);
    router.push(LEGACY_PAGE_REDIRECTS[raw] || canonicalPagePath(path));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Real identity comes only from the server session (HttpOnly cookie).
  const [authUser, setAuthUser] = useState<SafeUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const currentUser: SafeUser = authUser || GUEST_READER;
  const isAuthenticated = authUser !== null;
  const clearPrivateData = () => {
    authGeneration.current++;
    setAuthUser(null);
    setAuthEpoch((e) => e + 1);
    setNotification(null);
  };
  const updateAccountIdentity = (user: SafeUser) => setAuthUser(user);

  // Double-submit CSRF: echo the readable csrf_token cookie on mutations.
  const readCsrfCookie = (): string | undefined => {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  };

  const apiCall: ApiCall = async <T,>(endpoint: string, options: { method?: string; body?: unknown } = {}) => {
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
        // 401s are routine for logged-out visitors (e.g. /api/auth/me).
        if (res.status !== 401) showNotification(errorMessage, 'error');
        return { data: null, error: errorMessage, status: res.status, details: errorJson };
      }
      const json = await res.json();
      if (generation !== authGeneration.current) return { data: null, error: 'Session changed. Please try again.' };
      return { data: json as T, error: null, status: res.status };
    } catch (err: unknown) {
      console.warn(`[API] Failed to fetch from ${endpoint}:`, err);
      return { data: null, error: 'Network failure' };
    }
  };

  const login = async (email: string, password: string, totpCode?: string) => {
    // PHASE R: accounts with two-factor authentication also send the 6-digit code.
    const res = await apiCall<{ user: SafeUser }>('/api/auth/login', { method: 'POST', body: { email, password, ...(totpCode ? { totpCode } : {}) } });
    if (res.data?.user) {
      clearPrivateData();
      setAuthUser(res.data.user);
      showNotification(`Welcome back, ${res.data.user.name}.`, 'success');
      return { success: true };
    }
    return { success: false, error: res.error || 'Login failed.', totpRequired: res.details?.totpRequired === true };
  };

  const logout = async () => {
    const result = await apiCall<{ success: boolean }>('/api/auth/logout', { method: 'POST', body: {} });
    if (!result.data?.success) {
      showNotification('Logout could not be completed. Please try again.', 'error');
      return false;
    }
    clearPrivateData();
    try { localStorage.setItem('sportingspy_logout', String(Date.now())); } catch { /* ignore */ }
    showNotification('Logged out.', 'info');
    navigate('/');
    return true;
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect expiry/revocation/role changes made elsewhere.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, authUser?.role]);

  return (
    <SiteContext.Provider
      value={{
        theme,
        toggleTheme,
        themePreference,
        setThemePreference,
        // The account-area language switch belongs to reader accounts
        // (launch-disabled); English is used while that flag is off.
        accountLanguage: features.readerAccounts ? storedLanguage : 'en',
        setAccountLanguage,
        currentPath,
        navigate,
        currentUser,
        authUser,
        isAuthenticated,
        authLoading,
        login,
        logout,
        apiCall,
        updateAccountIdentity,
        authEpoch,
        authGeneration,
        features,
        notification,
        showNotification,
        clearNotification,
      }}
    >
      {notification && (
        <div className="fixed top-5 right-5 z-50 max-w-md w-full shadow-2xl rounded-xl border p-4 backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-top-4 flex items-start space-x-3 bg-white/95 dark:bg-stone-900/95 border-stone-200 dark:border-stone-800">
          {notification.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
          {notification.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
          {notification.type === 'info' && <Info className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />}
          <div className="flex-1 text-sm font-medium leading-snug">{notification.message}</div>
          <button
            onClick={clearNotification}
            className="text-stone-500 hover:text-stone-600 dark:hover:text-stone-200 p-0.5 rounded transition-colors dark:text-stone-400"
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {children}
    </SiteContext.Provider>
  );
};

export function useSite(): SiteContextType {
  const context = useContext(SiteContext);
  if (!context) throw new Error('useSite must be used within a SiteProvider');
  return context;
}
