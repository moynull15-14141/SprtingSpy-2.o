import type { AdCreative } from '../../types';

/** Same sized stage is used by CMS preview and the public sponsor slot. */
export function AdCreativeDisplay({ creative, alt, fit = 'contain', dimensions, linkUrl, placement }: {
  creative: AdCreative; alt: string; fit?: string; dimensions: string; linkUrl?: string; placement?: string;
}) {
  const square = dimensions.startsWith('300x');
  const mobileSquare = dimensions.includes('/');
  const height = square ? 'h-[250px] max-w-[300px]' : mobileSquare ? 'h-[250px] sm:h-[90px] max-w-[728px]' : 'h-[90px] max-w-[728px]';
  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain';
  const image = <img src={creative.url} alt={alt} width={creative.width} height={creative.height} className={`h-full w-full ${objectFit}`} loading="lazy"/>;
  return <div className={`mx-auto w-full overflow-hidden rounded bg-stone-950 ${height}`} data-ad-creative={creative.id}>
    {creative.kind === 'video' ? <video key={creative.id} src={creative.url} aria-label={alt} controls muted playsInline preload="metadata" className={`h-full w-full ${objectFit}`} />
      : linkUrl ? <a href={linkUrl} target="_blank" rel="noopener noreferrer sponsored" data-ad-placement={placement} data-ad-provider="house" className="block h-full w-full">{image}</a> : image}
  </div>;
}
