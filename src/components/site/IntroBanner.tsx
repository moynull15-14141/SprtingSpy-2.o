import React from 'react';
import type { HomeSection } from '../../lib/siteExperience/types';
import type { MediaAsset } from '../../lib/media';
import { DEFAULT_INTRO_APPEARANCE } from '../../lib/siteExperience/intro';
import { ResponsiveImage } from '../editorial/ResponsiveImage';
import { SiteLink } from './SiteLink';
import styles from './IntroBanner.module.css';

export function IntroBanner({ section: s, image, firstHeading = false, preview = false, mobilePreview = false }: {
  section: Extract<HomeSection, { type: 'intro' }>; image?: MediaAsset | null;
  firstHeading?: boolean; preview?: boolean; mobilePreview?: boolean;
}) {
  const a = s.appearance ?? DEFAULT_INTRO_APPEARANCE;
  const [lead, ...rest] = s.eyebrow.split(' · ');
  const Heading = preview ? 'h3' : firstHeading ? 'h1' : 'h2';
  const variables = {
    '--focal-x': `${a.focalX}%`, '--focal-y': `${a.focalY}%`,
    '--mobile-focal-x': `${a.mobileFocalX}%`, '--mobile-focal-y': `${a.mobileFocalY}%`,
    '--zoom': a.zoom / 100, '--scrim': a.overlay / 100,
  } as React.CSSProperties;
  const cta = (link: NonNullable<typeof s.primaryCta>, secondary = false) => preview
    ? <span className={secondary ? styles.secondary : styles.primary}>{link.label}</span>
    : <SiteLink href={link.href} className={secondary ? styles.secondary : styles.primary}>{link.label}</SiteLink>;
  return <section data-section={s.id} data-intro-style={a.style} data-height={a.height} data-text-size={a.textSize}
    data-align={a.align} data-vertical={a.vertical} data-width={a.width} data-device={mobilePreview ? 'mobile' : undefined}
    data-preview={preview ? 'true' : undefined} className={styles.banner} style={variables}>
    {image && <div className={styles.background} aria-hidden="true"><ResponsiveImage asset={image} alt="" sizes={preview ? '(max-width: 640px) 100vw, 900px' : '(max-width: 1536px) 100vw, 1536px'} className={styles.image} priority={!preview && firstHeading} /></div>}
    <div className={styles.scrim} aria-hidden="true" />
    <div className={styles.treatment} aria-hidden="true" />
    <div className={styles.content}>
      {s.eyebrow && <div className={styles.eyebrow}><span>{lead}</span>{rest.length > 0 && <><span aria-hidden="true"> · </span><span className={styles.secondaryEyebrow}>{rest.join(' · ')}</span></>}</div>}
      <Heading className={styles.heading}>{s.title}</Heading>
      {s.text && <p className={styles.text}>{s.text}</p>}
      {(s.primaryCta || s.secondaryCta) && <div className={styles.actions}>{s.primaryCta && cta(s.primaryCta)}{s.secondaryCta && cta(s.secondaryCta, true)}</div>}
    </div>
  </section>;
}
