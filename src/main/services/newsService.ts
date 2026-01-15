import { net } from 'electron';
import { XMLParser } from 'fast-xml-parser';

export interface NewsItem {
    id: string;
    type: 'news' | 'warning' | 'study';
    title: string;
    summary: string;
    source: string;
    date: string;
    url: string;
    imageUrl?: string;
}

const CACHE_TTL = 1000 * 60 * 60; // 1 hour
let newsCache: NewsItem[] = [];
let lastFetch = 0;

type StatusCallback = (msg: string) => void;

export async function getDeviceNews(onStatus?: StatusCallback): Promise<NewsItem[]> {
    if (Date.now() - lastFetch < CACHE_TTL && newsCache.length > 0) {
        onStatus?.('Loading from cache...');
        return newsCache;
    }

    onStatus?.('Initializing news fetch...');

    // We start all fetches but don't await them immediately so they run in parallel
    const tasks = [
        fetchOpenFDARecalls(onStatus),
        fetchGoogleDeviceNews(onStatus)
    ];

    const results = await Promise.allSettled(tasks);

    onStatus?.('Processing results...');

    const items: NewsItem[] = [];
    results.forEach(res => {
        if (res.status === 'fulfilled') {
            items.push(...res.value);
        }
    });

    // Deduplicate by URL
    const uniqueItems = Array.from(new Map(items.map(item => [item.url, item])).values());

    // Sort by date desc
    uniqueItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (uniqueItems.length > 0) {
        newsCache = uniqueItems;
        lastFetch = Date.now();
    }

    onStatus?.('Done');
    return uniqueItems;
}

async function fetchOpenFDARecalls(onStatus?: StatusCallback): Promise<NewsItem[]> {
    try {
        onStatus?.('Fetching FDA Recalls...');
        const query = 'product_description:pacemaker';
        const url = `https://api.fda.gov/device/enforcement.json?search=${query}&limit=15&sort=recall_initiation_date:desc`;

        const data = await fetchJson(url);
        if (!data || !data.results) return [];

        onStatus?.(`Found ${data.results.length} FDA recalls`);

        return data.results.map((r: any) => ({
            id: `fda-${r.report_number}`,
            type: 'warning',
            title: `Recall: ${r.product_description.substring(0, 100)}...`,
            summary: r.reason_for_recall,
            source: `FDA (${r.recalling_firm})`,
            date: r.recall_initiation_date ? r.recall_initiation_date.substring(0, 10).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : 'Unknown Date',
            url: r.recall_number
                ? `https://www.google.com/search?q=${encodeURIComponent('site:accessdata.fda.gov "' + r.recall_number + '"')}`
                : 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm',
            imageUrl: undefined
        }));
    } catch (e) {
        console.error('OpenFDA Error:', e);
        return [];
    }
}

async function fetchGoogleDeviceNews(onStatus?: StatusCallback): Promise<NewsItem[]> {
    try {
        onStatus?.('Fetching Google News (Devices)...');
        // Google News RSS - using query for cardiac implants
        const rssUrl = 'https://news.google.com/rss/search?q=cardiac+implants+pacemaker+defibrillator&hl=en-US&gl=US&ceid=US:en';

        const xml = await fetchText(rssUrl);
        const parser = new XMLParser({ ignoreAttributes: false });
        const result = parser.parse(xml);

        const channel = result?.rss?.channel || result?.feed;
        let items = channel?.item || channel?.entry || [];

        if (items && !Array.isArray(items)) items = [items];
        if (!Array.isArray(items)) return [];

        // Return up to 15 items
        const sliced = items.slice(0, 15);
        onStatus?.(`Found ${sliced.length} Google News items`);

        return sliced.map((item: any) => ({
            id: `gn-${item.guid || item.link}`,
            type: 'news',
            title: item.title,
            summary: item.description?.replace(/<[^>]*>/g, '').substring(0, 200) + '...' || 'No summary available',
            source: 'Google News',
            date: item.pubDate ? new Date(item.pubDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            url: item.link,
            imageUrl: undefined
        }));
    } catch (e) {
        console.error('Google News Error:', e);
        return [];
    }
}

async function fetchJson(url: string) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'KardiSynch/1.0' },
            signal: controller.signal
        });
        clearTimeout(id);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return await response.json();
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

async function fetchText(url: string) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'KardiSynch/1.0' },
            signal: controller.signal
        });
        clearTimeout(id);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return await response.text();
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}
