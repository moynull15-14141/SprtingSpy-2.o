/**
 * SportingSpy Top Navigation Bar
 * Implements strict Top Bar Contract:
 * Zone 1: Single text element wordmark (Brand Zone)
 * Zone 2: 4-6 clean single-line text nav links
 * Zone 3: 1-2 primary actions (Theme toggle + User/CMS quick access)
 */

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSite } from '../../context/SiteContext';
import { BRANDING } from '../../config/branding';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { SportIcon } from '../ui/SportIcon';
import { SiteLink } from '../site/SiteLink';
import type { NavItem } from '../../lib/siteExperience/types';

interface HeaderProps {
  /** Visible sports for the navigation menus, loaded on the server. */
  sports: { id: string; slug: string; name: string; icon?: string | null }[];
  /** PHASE F.1: navigation items from the Site Experience (published, or draft in preview). */
  navigation: NavItem[];
  /** PHASE H: site name from Admin → Settings (defaults to the built-in brand). */
  siteName?: string;
}

export const Header: React.FC<HeaderProps> = ({ sports, navigation, siteName }) => {
  const brandName = siteName && siteName !== BRANDING.name ? siteName : BRANDING.shortName;
  const { currentPath, navigate, theme, toggleTheme, currentUser, isAuthenticated, login, logout } = useSite();
  const [isSportsMenuOpen, setIsSportsMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
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
    } else {
      if (result.totpRequired) setTotpRequired(true);
      setLoginError(result.totpRequired && !totpRequired ? null : result.error || 'Login failed.');
    }
  };

  const isActive = (path: string) => {
    if (path === '/' && currentPath === '/') return true;
    if (path !== '/' && currentPath.startsWith(path)) return true;
    return false;
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#0c0d0e]/95 backdrop-blur-md border-b border-stone-200 dark:border-stone-800 transition-colors">
      <div className="max-w-[120rem] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ZONE 1: Brand Zone - Single element wordmark */}
          <div className="flex items-center gap-2">
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
          <nav aria-label="Main" className="hidden min-w-0 flex-1 flex-wrap justify-center md:flex items-center gap-x-3 gap-y-1 mx-3 text-sm font-medium lg:gap-x-6">
            {navigation.filter((item) => item.desktop).map((item) => item.kind === 'sportsMenu' ? (
            <div key={item.id} className="relative">
              <button
                type="button"
                onClick={() => setIsSportsMenuOpen(!isSportsMenuOpen)}
                aria-expanded={isSportsMenuOpen}
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
                  className="absolute left-0 mt-2 w-96 rounded-xl bg-white dark:bg-stone-900 shadow-xl border border-stone-200 dark:border-stone-800 p-4 grid grid-cols-2 gap-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  onMouseLeave={() => setIsSportsMenuOpen(false)}
                >
                  <div className="col-span-2 pb-2 mb-2 border-b border-stone-100 dark:border-stone-800 flex justify-between items-center text-xs text-stone-500 dark:text-stone-400">
                    <span className="font-semibold uppercase tracking-wider">All Active Sports</span>
                    <Link
                      href={item.href}
                      onClick={() => setIsSportsMenuOpen(false)}
                      className="text-amber-700 dark:text-amber-400 hover:underline"
                    >
                      View Directory &rarr;
                    </Link>
                  </div>
                  {sports
                    .map((sport) => (
                      <Link
                        key={sport.id}
                        href={`/${sport.slug}/`}
                        onClick={() => setIsSportsMenuOpen(false)}
                        className="text-left px-3 py-2 rounded-lg text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-950 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-3"
                      >
                        <SportIcon slug={sport.slug} name={sport.name} icon={sport.icon} />
                        <span className="font-medium">{sport.name}</span>
                      </Link>
                    ))}
                </div>
              )}
            </div>
            ) : (
            <SiteLink
              key={item.id}
              href={item.href}
              newTab={item.newTab}
              data-nav-item={item.id}
              onClick={() => setIsSportsMenuOpen(false)}
              className={`transition-colors py-2 cursor-pointer ${item.icon === 'search' ? 'flex items-center gap-1.5 ' : ''}${
                item.href.startsWith('/') && isActive(item.href.replace(/\/$/, '') || '/')
                  ? 'text-amber-700 dark:text-amber-400 font-semibold'
                  : 'text-stone-700 dark:text-stone-300 hover:text-stone-950 dark:hover:text-white'
              }`}
            >
              {item.icon === 'search' && (
                <svg className="w-4 h-4 text-stone-500 dark:text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
              {item.label}
            </SiteLink>
            ))}
          </nav>

          {/* ZONE 3: 1-2 primary actions */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
              aria-label={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>

            {/* Staff Login / Account Menu (PHASE 1: real authentication, not a role simulator) */}
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-900 transition-colors cursor-pointer text-xs"
              >
                {isAuthenticated ? (
                  <>
                    <Avatar src={currentUser.avatar} name={currentUser.name} className="w-5 h-5 rounded-full object-cover" />
                    <span className="font-medium text-stone-800 dark:text-stone-200 hidden sm:inline">{currentUser.role}</span>
                  </>
                ) : (
                  <span className="font-medium text-stone-800 dark:text-stone-200">Staff Login</span>
                )}
                <span aria-hidden="true" className="text-[10px] text-stone-500 dark:text-stone-400">▼</span>
              </button>

              {isUserMenuOpen && (
                <div
                  className="absolute right-0 mt-2 w-64 rounded-xl bg-white dark:bg-stone-900 shadow-xl border border-stone-200 dark:border-stone-800 p-2 z-50"
                  onMouseLeave={() => setIsUserMenuOpen(false)}
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
                      {/* PHASE 3: no "Open Editorial CMS" link here — the public
                          site must not advertise a navigation path to /admin.
                          Staff who need the CMS console navigate to it directly
                          (bookmark/URL); logging in here only establishes the
                          session that /admin's own access gate will then honor. */}
                      <div className="pt-1">
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
                      <p className="px-1 text-[11px] text-stone-500 dark:text-stone-400">Staff login for the Editorial CMS.</p>
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
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg cursor-pointer"
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
          <nav aria-label="Mobile" className="md:hidden py-4 border-t border-stone-200 dark:border-stone-800 space-y-2">
            {navigation.filter((item) => item.mobile).map((item) => item.kind === 'sportsMenu' ? (
              <div key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block w-full text-left px-3 py-2 text-base font-medium text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-md"
                >
                  {item.mobileLabel || item.label}
                </Link>
                <div className="grid grid-cols-2 gap-1 pl-4 pr-2">
                  {sports.slice(0, 8).map((sp) => (
                    <Link
                      key={sp.id}
                      href={`/${sp.slug}/`}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-2 text-left text-xs py-1.5 px-2 text-stone-600 dark:text-stone-400 hover:text-amber-600"
                    >
                      <SportIcon slug={sp.slug} name={sp.name} icon={sp.icon} size="sm" />
                      {sp.name}
                    </Link>
                  ))}
                </div>
              </div>
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
