import React from 'react';
import Link from 'next/link';

/** A configured link: site paths use client navigation; https links open safely. */
export function SiteLink({ href, newTab = false, className, children, ...rest }: { href: string; newTab?: boolean; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  if (href.startsWith('/')) return <Link href={href} className={className} {...rest}>{children}</Link>;
  return <a href={href} className={className} rel="noopener noreferrer" {...(newTab ? { target: '_blank' } : {})} {...rest}>{children}</a>;
}
