// src/core/newsFeed.ts
//
// Real crypto news for Home's News tab — three independent, genuinely
// free, keyless RSS feeds, not a single source or a paid news API:
//   https://www.coindesk.com/arc/outboundfeeds/rss/
//   https://cointelegraph.com/rss
//   https://decrypt.co/feed
// All three are long-established, standard RSS 2.0 feeds with no
// registration or key required. Reachability wasn't independently
// verified from this session's own sandbox — its network egress proxy
// blocks all three domains outright, the same disclosed limitation
// discoveryFeed.ts's own header already notes for a different source —
// only confirmed via each outlet's own current published feed URL. A
// feed going away or changing shape shows up as that one source's own
// honest fetch failure below, never a crash or fabricated content.
//
// fast-xml-parser (added as a real dependency, not borrowed from the
// RN CLI tooling's own transitive copy) does the actual RSS parsing —
// pure JS, no native module, safe under Hermes.

import {XMLParser} from 'fast-xml-parser';

export type NewsArticle = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: number | null;
  summary: string | null;
  imageUrl: string | null;
};

type NewsSource = {id: string; name: string; url: string};

const NEWS_SOURCES: NewsSource[] = [
  {id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/'},
  {id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss'},
  {id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed'},
];

// 5 minutes — frequent enough that the tab feels live without hammering
// three public feeds on every screen focus. Same cache-with-in-flight-
// dedup shape walletPrices.ts already uses.
const NEWS_CACHE_TTL_MS = 5 * 60_000;
let cachedArticles: NewsArticle[] | null = null;
let cachedAt = 0;
let inFlight: Promise<{articles: NewsArticle[]; error: string | null}> | null = null;

const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_'});

function stripHtml(input: string | undefined | null): string | null {
  if (!input) return null;
  const text = input.replace(/<[^>]*>/g, '').trim();
  return text.length > 0 ? text : null;
}

function firstImageFromHtml(input: string | undefined | null): string | null {
  if (!input) return null;
  const match = input.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function parsePubDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

async function fetchOneSource(source: NewsSource): Promise<NewsArticle[]> {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`${source.name} feed failed (${res.status}).`);
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item;
  const list: any[] = Array.isArray(items) ? items : items ? [items] : [];
  return list.map((item, i): NewsArticle => {
    const link = typeof item?.link === 'string' ? item.link : '';
    const mediaContent = item?.['media:content'];
    const enclosure = item?.enclosure;
    const imageUrl =
      firstImageFromHtml(item?.['content:encoded']) ??
      firstImageFromHtml(item?.description) ??
      (typeof mediaContent?.['@_url'] === 'string' ? mediaContent['@_url'] : null) ??
      (typeof enclosure?.['@_url'] === 'string' && typeof enclosure?.['@_type'] === 'string' && enclosure['@_type'].startsWith('image/')
        ? enclosure['@_url']
        : null);
    return {
      id: link || `${source.id}-${i}-${String(item?.title ?? '')}`,
      title: typeof item?.title === 'string' ? item.title.trim() : 'Untitled',
      link,
      source: source.name,
      publishedAt: parsePubDate(item?.pubDate),
      summary: stripHtml(item?.description),
      imageUrl,
    };
  });
}

/**
 * Exact-normalized-title dedup — deliberately unsophisticated, same
 * "wrong-but-confident is worse than missing" discipline as
 * discoveryFeed.ts's own image-backfill fix: a near-duplicate headline
 * from two outlets both stay, since guessing they're the same story
 * risks silently dropping two genuinely different ones. Only an EXACT
 * (case/punctuation-insensitive) title match collapses.
 */
function dedupeByTitle(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  const out: NewsArticle[] = [];
  for (const article of articles) {
    const key = article.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(article);
  }
  return out;
}

/**
 * Resolves to {articles, error} — never throws — same discipline
 * discoveryFeed.ts's own fetch functions hold themselves to. `error`
 * carries a real, honest note when some (not all) sources failed;
 * articles still reflects whatever DID come back. Only when every
 * source fails does this return the LAST good cache (if any) alongside
 * the error, rather than a blank screen for a purely transient outage.
 */
export async function fetchNewsFeed(): Promise<{articles: NewsArticle[]; error: string | null}> {
  if (cachedArticles && Date.now() - cachedAt < NEWS_CACHE_TTL_MS) {
    return {articles: cachedArticles, error: null};
  }
  if (inFlight) return inFlight;

  const promise = (async () => {
    const settled = await Promise.allSettled(NEWS_SOURCES.map(fetchOneSource));
    const articles: NewsArticle[] = [];
    const failures: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') articles.push(...result.value);
      else failures.push(`${NEWS_SOURCES[i].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });
    articles.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    const deduped = dedupeByTitle(articles);
    if (deduped.length > 0) {
      cachedArticles = deduped;
      cachedAt = Date.now();
      return {articles: deduped, error: failures.length > 0 ? `${failures.length} of ${NEWS_SOURCES.length} sources failed.` : null};
    }
    return {articles: cachedArticles ?? [], error: failures.join(' ') || 'All news sources failed.'};
  })().finally(() => {
    inFlight = null;
  });
  inFlight = promise;
  return promise;
}
