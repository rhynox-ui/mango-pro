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

import AsyncStorage from '@react-native-async-storage/async-storage';
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
// dedup shape walletPrices.ts already uses. This is the in-MEMORY cache
// (gone on app restart) — see the AsyncStorage layer below for what
// actually survives one.
const NEWS_CACHE_TTL_MS = 5 * 60_000;
let cachedArticles: NewsArticle[] | null = null;
let cachedAt = 0;
let inFlight: Promise<{articles: NewsArticle[]; error: string | null}> | null = null;

// Real, on-device persistence — a fresh install/reopen shows the last
// real fetch immediately instead of a blank loading state, and it
// survives across app restarts (the in-memory cache above doesn't).
// Articles older than this get dropped on every write, not just read —
// an RSS-fed store grows forever otherwise, and nothing here is useful
// to a user 10 days later anyway.
const NEWS_STORAGE_KEY = 'mango_pro_news_articles_v1';
const NEWS_RETENTION_MS = 10 * 24 * 60 * 60_000;

function pruneStale(articles: NewsArticle[]): NewsArticle[] {
  const cutoff = Date.now() - NEWS_RETENTION_MS;
  // No real publishedAt (parse failure) is kept, not dropped — an
  // unknown age isn't evidence of staleness, and this app never treats
  // "we couldn't read a field" as "this is old."
  return articles.filter(a => a.publishedAt == null || a.publishedAt >= cutoff);
}

async function loadStoredArticles(): Promise<NewsArticle[]> {
  try {
    const raw = await AsyncStorage.getItem(NEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? pruneStale(parsed) : [];
  } catch {
    return [];
  }
}

async function saveStoredArticles(articles: NewsArticle[]): Promise<void> {
  try {
    await AsyncStorage.setItem(NEWS_STORAGE_KEY, JSON.stringify(pruneStale(articles)));
  } catch {
    // best-effort — a failed write just means nothing to show cold-start
    // next time, never a hard error blocking the feed itself
  }
}

/**
 * Real, on-device cached articles — for showing something immediately
 * while fetchNewsFeed()'s own network round-trip is still in flight,
 * same "show what's real on disk first" pattern ProfileScreen's own
 * portfolio history already uses. Already pruned to the retention
 * window; never a network call itself.
 */
export async function loadCachedNewsArticles(): Promise<NewsArticle[]> {
  return loadStoredArticles();
}

const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_'});

// Some feeds (Decrypt's confirmed) double-encode entities in their
// titles/descriptions — fast-xml-parser only unwraps the outer XML
// layer, so what's left after that is still literal HTML-entity text
// (e.g. "Biden&#39;s") that needs a second decode pass. Covers numeric
// entities plus the small set of named ones actually seen in RSS
// content — not a full HTML-entity table, since pulling one in for
// this is overkill under Hermes.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

function stripHtml(input: string | undefined | null): string | null {
  if (!input) return null;
  const text = decodeHtmlEntities(input.replace(/<[^>]*>/g, '')).trim();
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
    const mediaThumbnail = item?.['media:thumbnail'];
    const enclosure = item?.enclosure;
    const imageUrl =
      firstImageFromHtml(item?.['content:encoded']) ??
      firstImageFromHtml(item?.description) ??
      (typeof mediaContent?.['@_url'] === 'string' ? mediaContent['@_url'] : null) ??
      (typeof mediaThumbnail?.['@_url'] === 'string' ? mediaThumbnail['@_url'] : null) ??
      (typeof enclosure?.['@_url'] === 'string' && typeof enclosure?.['@_type'] === 'string' && enclosure['@_type'].startsWith('image/')
        ? enclosure['@_url']
        : null);
    const rawTitle = typeof item?.title === 'string' ? item.title.trim() : '';
    return {
      id: link || `${source.id}-${i}-${rawTitle}`,
      title: rawTitle ? decodeHtmlEntities(rawTitle) : 'Untitled',
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
 *
 * Every successful (partial or full) fetch merges into the on-device
 * store — a source that failed THIS round doesn't erase what it
 * contributed last round, and old entries roll off after
 * NEWS_RETENTION_MS regardless of whether anything new came in.
 */
export async function fetchNewsFeed(): Promise<{articles: NewsArticle[]; error: string | null}> {
  if (cachedArticles && Date.now() - cachedAt < NEWS_CACHE_TTL_MS) {
    return {articles: cachedArticles, error: null};
  }
  if (inFlight) return inFlight;

  const promise = (async () => {
    const settled = await Promise.allSettled(NEWS_SOURCES.map(fetchOneSource));
    const fresh: NewsArticle[] = [];
    const failures: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') fresh.push(...result.value);
      else failures.push(`${NEWS_SOURCES[i].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });

    if (fresh.length === 0) {
      const stored = await loadStoredArticles();
      const fallback = cachedArticles ?? stored;
      return {articles: fallback, error: failures.join(' ') || 'All news sources failed.'};
    }

    const stored = await loadStoredArticles();
    const merged = dedupeByTitle([...fresh, ...stored].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)));
    cachedArticles = merged;
    cachedAt = Date.now();
    saveStoredArticles(merged);
    return {articles: merged, error: failures.length > 0 ? `${failures.length} of ${NEWS_SOURCES.length} sources failed.` : null};
  })().finally(() => {
    inFlight = null;
  });
  inFlight = promise;
  return promise;
}
