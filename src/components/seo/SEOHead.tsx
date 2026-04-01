import React, { useEffect } from 'react';

type JsonLdValue = Record<string, unknown> | Array<Record<string, unknown>>;

export interface SEOHeadProps {
  title: string;
  description: string;
  canonicalPath?: string;
  robots?: string;
  ogType?: 'website' | 'article';
  ogImage?: string;
  twitterCard?: 'summary' | 'summary_large_image';
  jsonLd?: JsonLdValue;
}

const DEFAULT_ROBOTS = 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1';
const DEFAULT_OG_IMAGE = '/icons/icon-512.png';
const DEFAULT_CANONICAL_ORIGIN = 'https://thedrip.bet';
const CANONICAL_ORIGIN =
  (import.meta.env.VITE_CANONICAL_ORIGIN || DEFAULT_CANONICAL_ORIGIN).replace(/\/+$/, '');

const ensureMetaTag = (
  selector: string,
  attrs: Record<string, string>,
  content: string,
): HTMLMetaElement => {
  let node = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement('meta');
    Object.entries(attrs).forEach(([key, value]) => node?.setAttribute(key, value));
    document.head.appendChild(node);
  }
  node.setAttribute('content', content);
  return node;
};

const canonicalizePath = (value: string): string => {
  if (!value) return '/';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return value.startsWith('/') ? value : `/${value}`;
};

const absoluteUrl = (pathOrUrl: string): string => {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  return `${CANONICAL_ORIGIN}${canonicalizePath(pathOrUrl)}`;
};

export const SEOHead: React.FC<SEOHeadProps> = ({
  title,
  description,
  canonicalPath,
  robots = DEFAULT_ROBOTS,
  ogType = 'website',
  ogImage = DEFAULT_OG_IMAGE,
  twitterCard = 'summary_large_image',
  jsonLd,
}) => {
  useEffect(() => {
    document.title = title;

    const canonicalUrl = absoluteUrl(canonicalPath || window.location.pathname);
    const ogImageUrl = absoluteUrl(ogImage);

    let canonicalNode = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonicalNode) {
      canonicalNode = document.createElement('link');
      canonicalNode.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalNode);
    }
    canonicalNode.setAttribute('href', canonicalUrl);

    ensureMetaTag('meta[name="description"]', { name: 'description' }, description);
    ensureMetaTag('meta[name="robots"]', { name: 'robots' }, robots);
    ensureMetaTag('meta[property="og:type"]', { property: 'og:type' }, ogType);
    ensureMetaTag('meta[property="og:title"]', { property: 'og:title' }, title);
    ensureMetaTag('meta[property="og:description"]', { property: 'og:description' }, description);
    ensureMetaTag('meta[property="og:url"]', { property: 'og:url' }, canonicalUrl);
    ensureMetaTag('meta[property="og:image"]', { property: 'og:image' }, ogImageUrl);
    ensureMetaTag('meta[name="twitter:card"]', { name: 'twitter:card' }, twitterCard);
    ensureMetaTag('meta[name="twitter:title"]', { name: 'twitter:title' }, title);
    ensureMetaTag('meta[name="twitter:description"]', { name: 'twitter:description' }, description);
    ensureMetaTag('meta[name="twitter:image"]', { name: 'twitter:image' }, ogImageUrl);

    const staleJsonLd = Array.from(document.head.querySelectorAll('script[data-seo-jsonld="true"]'));
    staleJsonLd.forEach((node) => node.remove());

    if (jsonLd) {
      const payloads = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      payloads.forEach((payload) => {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.setAttribute('data-seo-jsonld', 'true');
        script.textContent = JSON.stringify(payload);
        document.head.appendChild(script);
      });
    }
  }, [title, description, canonicalPath, robots, ogType, ogImage, twitterCard, jsonLd]);

  return null;
};

export default SEOHead;
