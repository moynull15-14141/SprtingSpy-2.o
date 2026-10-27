/**
 * SportingSpy Top Navigation Bar
 * Implements strict Top Bar Contract:
 * Zone 1: Single text element wordmark (Brand Zone)
 * Zone 2: 4-6 clean single-line text nav links
 * Zone 3: 1-2 primary actions (Theme toggle + User/CMS quick access)
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSite } from '../../context/SiteContext';
import { BRANDING } from '../../config/branding';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { SportIcon, GroupGlyph } from '../ui/SportIcon';
import { SiteLink } from '../site/SiteLink';
import type { NavItem } from '../../lib/siteExperience/types';

/** Roles that can open the CMS (the /admin access gate enforces the same list). */
const STAFF_ROLES = ['Admin', 'Editor', 'Author'];

interface HeaderProps {
  /** Visible sports for the navigation menus, loaded on the server. */
  sports: { id: string; slug: string; name: string; icon?: string | null; iconImage?: string | null; groups?: { slug: string; name: string; icon?: string | null; iconImage?: string | null }[] }[];
  /** PHASE F.1: navigation items from the Site Experience (published, or draft in preview). */
  navigation: NavItem[];
  /** PHASE H: site name from Admin → Settings (defaults to the built-in brand). */
  siteName?: string;
}

/**
 * PHASE R UI/UX: click-opened menus close on Escape, an outside click/tap or
 * navigation. The desktop Sports panel also follows conventional hover
 * behavior: pointer in opens it and pointer out closes it. Sign-in remains
 * click-only so moving the pointer never interrupts its form.
 */
function useDismissible(open: boolean, close: () => void, wrapper: React.RefObject<HTMLElement | null>, trigger: React.RefObject<HTMLElement | null>, path: string) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); trigger.current?.focus(); } };
    const onPointer = (e: PointerEvent) => { if (wrapper.current && !wrapper.current.contains(e.target as Node)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [open, close, wrapper, trigger]);
  useEffect(() => { close(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const Header: React.FC<HeaderProps> = ({ sports, navigation, siteName }) => {
  const brandName = siteName && siteName !== BRANDING.name ? siteName : BRANDING.shortName;
  const { currentPath, navigate, theme, themePreference, setThemePreference, currentUser, isAuthenticated, login, logout, features } = useSite();
  const [isSportsMenuOpen, setIsSportsMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Mobile: the sport whose groups are expanded (tap to expand, one at a time).
  const [mobileSportOpen, setMobileSportOpen] = useState<string | null>(null);
  // A mouse pointer opens the Sports panel by hovering; the click that follows must not close it again.
  const sportsOpenedByHover = useRef(false);
  const sportsPanelRef = useRef<HTMLDivElement>(null);
  const focusSportsLink = (which: 'first' | 'next' | 'previous' | 'last') => {
    const links = [...(sportsPanelRef.current?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])];
    if (!links.length) return;
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const index = which === 'first' ? 0 : which === 'last' ? links.length - 1 : which === 'next' ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1);
    links[index].focus();
  };
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    const result = await login(loginEmail, loginPassword, totpRequired ? totpCode.trim() : undefined);
    setIsLoggingIn(false);
    if (result.success) {
      setLoginEmail('');
      setLoginPassword('');
      setTotpRequired(false);
      setTotpCode('');
      setIsUserMenuOpen(false);
      navigate(result.user && STAFF_ROLES.includes(result.user.role) ? '/admin/' : '/account');
    } else {
      if (result.totpRequired) setTotpRequired(true);
      setLoginError(result.totpRequired && !totpRequired ? null : result.error || 'Login failed.');
    }
  };

  const sportsMenuRef = useRef<HTMLDivElement>(null);
  const sportsButtonRef = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const searchMenuRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeSportsMenu = React.useCallback(() => {
    sportsOpenedByHover.current = false;
    setIsSportsMenuOpen(false);
  }, []);
  const closeUserMenu = React.useCallback(() => setIsUserMenuOpen(false), []);
  const closeSearchMenu = React.useCallback(() => setIsSearchOpen(false), []);
  useDismissible(isSportsMenuOpen, closeSportsMenu, sportsMenuRef, sportsButtonRef, currentPath);
  useDismissible(isUserMenuOpen, closeUserMenu, userMenuRef, userButtonRef, currentPath);
  useDismissible(isSearchOpen, closeSearchMenu, searchMenuRef, searchButtonRef, currentPath);
  useEffect(() => {
    if (isSearchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [isSearchOpen]);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    closeSearchMenu();
    setIsMobileMenuOpen(false);
    navigate(`/search/?q=${encodeURIComponent(query)}`);
  };

  const isActive = (path: string) => {
    if (path === '/' && currentPath === '/') return true;
    if (path !== '/' && currentPath.startsWith(path)) return true;
    return false;
  };

  return (
    <header className="site-header sticky top-0 z-40 bg-white/95 dark:bg-[#0c0d0e]/95 backdrop-blur-md border-b border-stone-200 dark:border-stone-800 transition-colors">
      <div className="site-header-frame max-w-[120rem] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="site-header-row flex items-center justify-between h-16">
          {/* ZONE 1: Brand Zone - Single element wordmark */}
          <div className="site-header-brand flex items-center gap-2">
            <Link
              href="/"
              onClick={() => {
                setIsSportsMenuOpen(false);
                setIsMobileMenuOpen(false);
              }}
              className="group text-left cursor-pointer flex items-center gap-2"
              aria-label={`${siteName || BRANDING.name} Home`}
            >
              <span className="font-display text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-500 transition-colors">
                {brandName}
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-700 dark:bg-amber-500 inline-block self-center mb-0.5"></span>
            </Link>
          </div>

          {/* ZONE 2: 4-6 clean text navigation links */}
          <nav aria-label="Main" className="site-header-nav hidden min-w-0 flex-1 flex-wrap justify-center md:flex items-center gap-x-3 gap-y-1 mx-3 text-sm font-medium lg:gap-x-6">
            {navigation.filter((item) => item.desktop).map((item) => item.kind === 'sportsMenu' ? (
            <div key={item.id} className="relative" ref={sportsMenuRef}
              // The trigger and its absolute panel form one hover region: crossing
              // between them stays open; leaving both closes a hover-opened panel.
              onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !isSportsMenuOpen) { closeSearchMenu(); sportsOpenedByHover.current = true; setIsSportsMenuOpen(true); } }}
              onPointerLeave={(e) => { if (e.pointerType === 'mouse' && sportsOpenedByHover.current) closeSportsMenu(); }}
            >
              <button
                ref={sportsButtonRef}
                type="button"
                onClick={() => {
                  if (isSportsMenuOpen && sportsOpenedByHover.current) { sportsOpenedByHover.current = false; return; }
                  sportsOpenedByHover.current = false;
                  setIsSportsMenuOpen(!isSportsMenuOpen);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  sportsOpenedByHover.current = false;
                  if (isSportsMenuOpen) focusSportsLink('first');
                  else { setIsSportsMenuOpen(true); requestAnimationFrame(() => focusSportsLink('first')); }
                }}
                aria-expanded={isSportsMenuOpen}
                aria-controls="sports-menu-panel"
                data-nav-item={item.id}
                className={`flex items-center gap-1 transition-colors py-2 cursor-pointer ${
                  isActive('/sports') || isSportsMenuOpen
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-stone-700 dark:text-stone-300 hover:text-stone-950 dark:hover:text-white'
                }`}
              >
                {item.label}
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-150 ${isSportsMenuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Sports Mega Discovery Dropdown */}
              {isSportsMenuOpen && (
                <div
                  id="sports-menu-panel"
                  ref={sportsPanelRef}
                  data-testid="sports-menu"
                  onKeyDown={(e) => {
                    const move = e.key === 'ArrowDown' ? 'next' : e.key === 'ArrowUp' ? 'previous' : e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : null;
                    if (move) { e.preventDefault(); focusSportsLink(move); }
                  }}
                  className={`fixed left-1/2 -translate-x-1/2 top-[4.5rem] ${sports.some((sp) => sp.groups?.length) ? 'w-[52rem] lg:w-[60rem] max-w-[calc(100vw-2rem)]' : 'w-[32rem]'} max-h-[75vh] overflow-y-auto rounded-xl bg-white dark:bg-stone-900 shadow-xl border border-stone-200 dark:border-stone-800 p-4 z-50 animate-in fade-in duration-150`}
                >
                  <div className="pb-2 mb-2 border-b border-stone-100 dark:border-stone-800 flex justify-between items-center text-xs text-stone-500 dark:text-stone-400">
                    <span className="font-semibold uppercase tracking-wider">All Active Sports</span>
                    <Link
                      href={item.href}
                      onClick={() => setIsSportsMenuOpen(false)}
                      className="text-amber-700 dark:text-amber-400 hover:underline"
                    >
                      View Directory &rarr;
                    </Link>
                  </div>
                  {/* Two levels: each sport, and directly under it the groups a visitor can browse.
                      CSS columns (not a grid) so a sport with groups never leaves the sport beside
                      it with empty space below — items pack tightly down each column.
                      Three columns on wide screens keep the panel short. */}
                  <ul className={`columns-2 gap-x-6 ${sports.some((sp) => sp.groups?.length) ? 'lg:columns-3' : ''}`}>
                    {sports.map((sport) => (
                      <li key={sport.id} data-sport={sport.slug} className="min-w-0 mb-1 break-inside-avoid">
                        <Link
                          href={`/${sport.slug}/`}
                          onClick={() => setIsSportsMenuOpen(false)}
                          className="text-left px-3 py-2 rounded-lg text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-950 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-3"
                        >
                          <SportIcon slug={sport.slug} name={sport.name} icon={sport.icon} iconImage={sport.iconImage} />
                          <span className="font-medium">{sport.name}</span>
                        </Link>
                        {!!sport.groups?.length && (
                          <ul aria-label={`${sport.name} groups`} className="ml-6 mt-0.5 mb-1 border-l border-stone-200 dark:border-stone-700 pl-3 space-y-0.5">
                            {sport.groups.map((group) => (
                              <li key={group.slug} data-group={group.slug}>
                                <Link
                                  href={`/${sport.slug}/${group.slug}/`}
                                  onClick={() => setIsSportsMenuOpen(false)}
                                  className="block rounded px-2 py-1 text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-950 dark:hover:text-white"
                                >
                                  <GroupGlyph icon={group.icon} iconImage={group.iconImage} className="mr-1" />{group.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            ) : item.icon === 'search' ? (
            <div key={item.id} ref={searchMenuRef} className="relative flex items-center">
              {/* The box sits BEFORE the button in the DOM, so when it grows from
                  width 0 it reveals on the left and pushes the "Search" button
                  smoothly to the right — the two stay side by side, never overlapping. */}
              <form
                id="header-search-panel"
                role="search"
                aria-label="Search SportingSpy"
                aria-hidden={!isSearchOpen}
                onSubmit={submitSearch}
                className={`overflow-hidden transition-[width,opacity,margin] duration-300 ease-out motion-reduce:transition-none ${isSearchOpen ? 'pointer-events-auto mr-2 w-44 opacity-100 lg:w-64 xl:w-72' : 'pointer-events-none mr-0 w-0 opacity-0'}`}
              >
                <label htmlFor="header-search-query" className="sr-only">Search articles, sports and events</label>
                <div className="relative w-44 lg:w-64 xl:w-72">
                  <input
                    ref={searchInputRef}
                    id="header-search-query"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search articles, sports and events"
                    autoComplete="off"
                    tabIndex={isSearchOpen ? 0 : -1}
                    required
                    className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-3 pr-10 text-sm text-stone-900 shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/25 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  />
                  <button type="submit" tabIndex={isSearchOpen ? 0 : -1} className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-lg text-stone-500 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 dark:text-stone-400 dark:hover:text-amber-400" aria-label="Submit search">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </button>
                </div>
              </form>
              <button
                ref={searchButtonRef}
                type="button"
                data-nav-item={item.id}
                aria-expanded={isSearchOpen}
                aria-controls="header-search-panel"
                onClick={() => {
                  closeSportsMenu();
                  closeUserMenu();
                  setIsSearchOpen((open) => !open);
                }}
                className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap py-2 transition-colors ${isActive('/search') || isSearchOpen ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-stone-700 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white'}`}
              >
                <svg className="h-4 w-4 text-stone-500 dark:text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {item.label}
              </button>
            </div>
            ) : (
            <SiteLink
              key={item.id}
              href={item.href}
              newTab={item.newTab}
              data-nav-item={item.id}
              onClick={() => setIsSportsMenuOpen(false)}
              className={`transition-colors py-2 cursor-pointer ${
                item.href.startsWith('/') && isActive(item.href.replace(/\/$/, '') || '/')
                  ? 'text-amber-700 dark:text-amber-400 font-semibold'
                  : 'text-stone-700 dark:text-stone-300 hover:text-stone-950 dark:hover:text-white'
              }`}
            >
              {item.label}
            </SiteLink>
            ))}
          </nav>

          {/* ZONE 3: 1-2 primary actions */}
          <div className="site-header-actions flex items-center gap-3">
            {/* Theme: Light → Dark → System (PHASE R UI/UX; System follows the OS live) */}
            {(() => {
              const next = themePreference === 'light' ? 'dark' : themePreference === 'dark' ? 'system' : 'light';
              const name = { light: 'Light', dark: 'Dark', system: 'System' } as const;
              const label = `Theme: ${name[themePreference]}${themePreference === 'system' ? ` (${theme})` : ''}. Switch to ${name[next]}`;
              return (
                <button
                  type="button"
                  onClick={() => setThemePreference(next)}
                  className="p-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  aria-label={label}
                  title={label}
                  data-theme-preference={themePreference}
                >
                  {themePreference === 'system' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="M8 20h8M12 16v4" /></svg>
                  ) : themePreference === 'dark' ? (
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                  ) : (
                    <svg className="w-5 h-5 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                  )}
                </button>
              );
            })()}

            {/* Sign-in / Account Menu (PHASE 1: real authentication, not a role simulator) */}
            <div className="relative" ref={userMenuRef}>
              <button
                ref={userButtonRef}
                type="button"
                aria-expanded={isUserMenuOpen}
                aria-haspopup="true"
                onClick={() => { closeSearchMenu(); setIsUserMenuOpen(!isUserMenuOpen); }}
                className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-900 transition-colors cursor-pointer text-xs"
              >
                {isAuthenticated ? (
                  <>
                    <Avatar src={currentUser.avatar} name={currentUser.name} className="w-5 h-5 rounded-full object-cover" />
                    <span className="font-medium text-stone-800 dark:text-stone-200 hidden sm:inline">{currentUser.role}</span>
                  </>
                ) : (
                  <span className="font-medium text-stone-800 dark:text-stone-200">Sign in</span>
                )}
                <span aria-hidden="true" className="text-[10px] text-stone-500 dark:text-stone-400">▼</span>
              </button>

              {isUserMenuOpen && (
                <div
                  className="absolute right-0 mt-2 w-64 rounded-xl bg-white dark:bg-stone-900 shadow-xl border border-stone-200 dark:border-stone-800 p-2 z-50"
                >
                  {isAuthenticated ? (
                    <>
                      <div className="px-3 py-2 border-b border-stone-100 dark:border-stone-800">
                        <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">{currentUser.name}</p>
                        <p className="text-[11px] text-stone-500 truncate dark:text-stone-400">{currentUser.email}</p>
                        <div className="mt-1 text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">
                          Role: {currentUser.role}
                        </div>
                      </div>
                      {/* PHASE 3 kept the public site from advertising /admin. The
                          Admin panel entry below is therefore shown only inside the
                          signed-in menu of staff (Admin, Editor, Author): anonymous
                          visitors and Readers never see it, and /admin's own access
                          gate still decides who may use the CMS. */}
                      <div className="pt-1">
                        {STAFF_ROLES.includes(currentUser.role) && (
                          <button data-testid="admin-panel-link" onClick={() => { navigate('/admin/'); setIsUserMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-stone-100 dark:text-amber-400 dark:hover:bg-stone-800 rounded-md">Admin panel</button>
                        )}
                        <button onClick={() => { navigate('/account'); setIsUserMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-stone-100 dark:hover:bg-stone-800 rounded-md">My account & settings</button>
                        <button
                          onClick={async () => {
                            await logout();
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-md font-medium"
                        >
                          Log Out
                        </button>
                      </div>
                    </>
                  ) : (
                    <form onSubmit={handleLogin} className="p-2 space-y-2">
                      <p className="px-1 text-[11px] text-stone-500 dark:text-stone-400">{features.readerAccounts ? 'Sign in to your account.' : 'Staff login for the Editorial CMS.'}</p>
                      <input
                        type="email"
                        required
                        autoFocus
                        placeholder="Email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      <input
                        type="password"
                        required
                        placeholder="Password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {totpRequired && <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus aria-label="Authentication code" placeholder="6-digit authentication code" value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/D/g, ''))} className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 tracking-widest" />}
                      {loginError && <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">{loginError}</p>}
                      <Button type="submit" size="sm" isLoading={isLoggingIn} className="w-full justify-center">
                        {totpRequired ? 'Verify' : 'Log In'}
                      </Button>
                      <a href="/reset-password/" className="block text-center text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400">Forgot password?</a>
                      {/* PHASE U: public readers need a visible way to register. Shown only
                          when reader accounts are enabled; the /register page is flag-gated too. */}
                      {features.readerAccounts && (
                        <div className="mt-1 border-t border-stone-100 pt-2 text-center dark:border-stone-800">
                          <span className="text-[11px] text-stone-500 dark:text-stone-400">New to SportingSpy? </span>
                          <a href={`/register?next=${encodeURIComponent(currentPath)}`} className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400">Create a free account</a>
                        </div>
                      )}
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => { closeSearchMenu(); setIsMobileMenuOpen(!isMobileMenuOpen); }}
              className="site-header-mobile-toggle md:hidden p-2 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg cursor-pointer"
              aria-label="Toggle Navigation Menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <nav aria-label="Mobile" className="site-header-mobile-nav md:hidden py-4 border-t border-stone-200 dark:border-stone-800 space-y-2">
            {navigation.filter((item) => item.mobile).map((item) => item.kind === 'sportsMenu' ? (
              <div key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block w-full text-left px-3 py-2 text-base font-medium text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-md"
                >
                  {item.mobileLabel || item.label}
                </Link>
                {/* The first eight sports as before, plus any later sport that has groups (so its groups stay reachable). */}
                <ul className="grid grid-cols-2 gap-1 pl-4 pr-2" data-testid="mobile-sports">
                  {sports.filter((sp, index) => index < 8 || !!sp.groups?.length).map((sp) => (
                    <li key={sp.id} data-sport={sp.slug} className={sp.groups?.length && mobileSportOpen === sp.slug ? 'col-span-2' : undefined}>
                      <div className="flex items-center">
                        <Link
                          href={`/${sp.slug}/`}
                          onClick={() => setIsMobileMenuOpen(false)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs py-1.5 px-2 text-stone-600 dark:text-stone-400 hover:text-amber-600"
                        >
                          <SportIcon slug={sp.slug} name={sp.name} icon={sp.icon} iconImage={sp.iconImage} size="sm" />
                          {sp.name}
                        </Link>
                        {!!sp.groups?.length && (
                          <button
                            type="button"
                            onClick={() => setMobileSportOpen(mobileSportOpen === sp.slug ? null : sp.slug)}
                            aria-expanded={mobileSportOpen === sp.slug}
                            aria-controls={`mobile-groups-${sp.slug}`}
                            aria-label={`${mobileSportOpen === sp.slug ? 'Hide' : 'Show'} ${sp.name} groups`}
                            className="shrink-0 rounded p-2 text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                          >
                            <svg className={`h-3.5 w-3.5 transition-transform ${mobileSportOpen === sp.slug ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </button>
                        )}
                      </div>
                      {!!sp.groups?.length && mobileSportOpen === sp.slug && (
                        <ul id={`mobile-groups-${sp.slug}`} aria-label={`${sp.name} groups`} className="ml-5 mb-1 border-l border-stone-200 pl-3 dark:border-stone-700">
                          {sp.groups.map((group) => (
                            <li key={group.slug} data-group={group.slug}>
                              <Link href={`/${sp.slug}/${group.slug}/`} onClick={() => setIsMobileMenuOpen(false)} className="block py-1.5 px-2 text-xs text-stone-600 dark:text-stone-400 hover:text-amber-600">
                                <GroupGlyph icon={group.icon} iconImage={group.iconImage} className="mr-1" />{group.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : item.icon === 'search' ? (
              <form key={item.id} role="search" aria-label="Mobile search" onSubmit={submitSearch} className="px-3 py-2">
                <label htmlFor="mobile-header-search-query" className="sr-only">Search articles, sports and events</label>
                <div className="flex items-center gap-2">
                  <input
                    id="mobile-header-search-query"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search articles, sports and events"
                    autoComplete="off"
                    required
                    className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/25 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                  />
                  <button type="submit" className="rounded-lg bg-amber-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                    Search
                  </button>
                </div>
              </form>
            ) : (
              <SiteLink
                key={item.id}
                href={item.href}
                newTab={item.newTab}
                onClick={() => setIsMobileMenuOpen(false)}
                className="block w-full text-left px-3 py-2 text-base font-medium text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-md"
              >
                {item.mobileLabel || item.label}
              </SiteLink>
            ))}
            {/* PHASE 3: no Admin/Editorial CMS entry in the mobile menu —
                the public site must not expose a navigation path to /admin. */}
          </nav>
        )}
      </div>
    </header>
  );
};
