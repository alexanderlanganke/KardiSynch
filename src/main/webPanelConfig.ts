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

const DEFAULT_BOOKMARKS: BookmarkConfig = {
  bookmarks: [
    {
      category: 'Remote Monitoring',
      items: [
        { label: 'CareLink', url: 'https://carelink.medtronic.com', icon: 'monitor' },
        { label: 'Home Monitoring', url: 'https://biotronik-homemonitoring.com', icon: 'monitor' },
        { label: 'Merlin.net', url: 'https://www.merlin.net', icon: 'monitor' },
        { label: 'LATITUDE', url: 'https://www.latitude.bostonscientific.com', icon: 'monitor' },
      ],
    },
    {
      category: 'MRI Compatibility',
      items: [
        { label: 'SureScan', url: 'https://www.medtronic.com/us-en/healthcare-professionals/therapies-procedures/cardiac-rhythm/mri-surescan.html', icon: 'mri' },
        { label: 'ProMRI Check', url: 'https://www.biotronik.com/en-de/promri', icon: 'mri' },
        { label: 'Merlin MRI', url: 'https://www.cardiovascular.abbott/us/en/hcp/products/cardiac-rhythm-management/cardiac-rhythm-management-resources/mri-resources.html', icon: 'mri' },
        { label: 'ImageReady', url: 'https://www.bostonscientific.com/en-US/medical-specialties/electrophysiology/mri-conditions.html', icon: 'mri' },
      ],
    },
    {
      category: 'Advisories & Recalls',
      items: [
        { label: 'BfArM', url: 'https://www.bfarm.de/DE/Medizinprodukte/Kundeninfos/_node.html', icon: 'alert' },
        { label: 'FDA MAUDE', url: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/search.cfm', icon: 'alert' },
      ],
    },
  ],
};

function getBookmarksPath(): string {
  return path.join(app.getPath('userData'), 'web_bookmarks.json');
}

function getDownloadConfigPath(): string {
  return path.join(app.getPath('userData'), 'web_downloads.json');
}

export function getBookmarks(): BookmarkConfig {
  try {
    const data = fs.readFileSync(getBookmarksPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return DEFAULT_BOOKMARKS;
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

export function setDownloadWhitelist(config: DownloadConfig): void {
  fs.writeFileSync(getDownloadConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
