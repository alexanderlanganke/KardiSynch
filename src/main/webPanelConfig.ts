import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getDefaultDownloadConfig } from './webPanelManager';

export interface Bookmark {
  label: string;
  url: string;
  icon: string;
}

export interface BookmarkCategory {
  category: string;
  items: Bookmark[];
}

export interface BookmarkConfig {
  bookmarks: BookmarkCategory[];
}

export interface DownloadConfig {
  remote_monitoring_domains: string[];
  intercept_file_types: string[];
  auto_prompt: boolean;
  domain_manufacturer_map: Record<string, string>;
}

// Countries that use the EU CareLink instance
const EU_COUNTRIES = [
  'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Austria',
  'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland', 'Czech Republic',
  'Portugal', 'Ireland', 'Greece', 'Hungary', 'Romania', 'Bulgaria', 'Croatia',
  'Slovakia', 'Slovenia', 'Lithuania', 'Latvia', 'Estonia', 'Luxembourg', 'Malta',
  'Cyprus', 'United Kingdom', 'UK',
];

export function getCareLinkUrl(country: string): string {
  const isEu = EU_COUNTRIES.some(
    (c) => c.toLowerCase() === country.toLowerCase()
  );
  return isEu ? 'https://europe.medtroniccarelink.net' : 'https://carelink.medtronic.com';
}

function getDefaultBookmarks(country: string): BookmarkConfig {
  return {
    bookmarks: [
      {
        category: 'Remote Monitoring',
        items: [
          { label: 'CareLink', url: getCareLinkUrl(country), icon: 'monitor' },
          { label: 'Home Monitoring', url: 'https://biotronik-homemonitoring.com', icon: 'monitor' },
          { label: 'Merlin.net', url: 'https://www.merlin.net', icon: 'monitor' },
          { label: 'LATITUDE', url: 'https://www.latitude.bostonscientific.com', icon: 'monitor' },
        ],
      },
      {
        category: 'MRI Compatibility',
        items: [
          { label: 'SureScan', url: 'https://www.medtronic.com/us-en/healthcare-professionals/mri-resources/implantable-cardiac-devices/product-listing.html', icon: 'mri' },
          { label: 'ProMRI Check', url: 'https://www.promricheck.com', icon: 'mri' },
          { label: 'MRI Safety', url: 'https://www.cardiovascular.abbott/us/en/hcp/mri-safety.html', icon: 'mri' },
          { label: 'ImageReady', url: 'https://www.bostonscientific.com/imageready/en-EU/home.html', icon: 'mri' },
        ],
      },
      {
        category: 'Advisories & Recalls',
        items: [
          { label: 'BfArM', url: 'https://www.bfarm.de/DE/Medizinprodukte/Aufgaben/Risikobewertung-und-Forschung/Massnahmen-von-Herstellern/_artikel.html', icon: 'alert' },
          { label: 'FDA MAUDE', url: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/search.cfm', icon: 'alert' },
        ],
      },
    ],
  };
}

function getBookmarksPath(): string {
  return path.join(app.getPath('userData'), 'web_bookmarks.json');
}

function getDownloadConfigPath(): string {
  return path.join(app.getPath('userData'), 'web_downloads.json');
}

export function getBookmarks(country?: string): BookmarkConfig {
  try {
    const data = fs.readFileSync(getBookmarksPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    // No saved bookmarks — generate defaults based on region
    return getDefaultBookmarks(country || 'Germany');
  }
}

export function setBookmarks(config: BookmarkConfig): void {
  fs.writeFileSync(getBookmarksPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getDownloadWhitelist(): DownloadConfig {
  try {
    const data = fs.readFileSync(getDownloadConfigPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return getDefaultDownloadConfig();
  }
}

// Plausible-hostname check: dotted labels of alphanumerics/hyphens (no
// leading/trailing hyphen per label), at least one dot. Permissive enough for
// real-world manufacturer domains (e.g. "latitude2.bostonscientific.com").
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const MAX_DOMAIN_LENGTH = 253; // max total length of a DNS hostname

function isPlausibleDomain(domain: string): boolean {
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) return false;
  return DOMAIN_PATTERN.test(domain);
}

/**
 * This list directly gates which downloaded files get auto-imported into the
 * patient record store, so entries coming from the renderer (settings UI)
 * are validated before being persisted. Invalid entries are dropped (with a
 * warning), not rejected outright, so a single bad entry doesn't block the
 * rest of a legitimate edit.
 */
function sanitizeDomainList(domains: unknown): string[] {
  if (!Array.isArray(domains)) return [];
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const raw of domains) {
    if (typeof raw !== 'string') {
      console.warn('[WebPanelConfig] Dropping non-string domain whitelist entry:', raw);
      continue;
    }
    const normalized = raw.trim().toLowerCase();
    if (!isPlausibleDomain(normalized)) {
      console.warn('[WebPanelConfig] Dropping invalid domain whitelist entry:', JSON.stringify(raw));
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    valid.push(normalized);
  }
  return valid;
}

export function setDownloadWhitelist(config: DownloadConfig): void {
  const sanitized: DownloadConfig = {
    ...config,
    remote_monitoring_domains: sanitizeDomainList(config?.remote_monitoring_domains),
  };
  fs.writeFileSync(getDownloadConfigPath(), JSON.stringify(sanitized, null, 2), 'utf-8');
}
