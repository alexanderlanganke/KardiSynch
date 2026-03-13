# KardiSynch — Claude Code Brief: Integrated Web Panel & Remote Monitoring Workflow

**Feature:** Web/Remote Panel with BrowserView, configurable quick-access links, OS-keychain credential storage, whitelisted download interception, and remote visit workflow integration.

**Status:** Ready for implementation.

**Prerequisite:** Existing KardiSynch codebase with working `_IMPORT` pipeline, `PatientAssignmentModal`, visit creation, and PDF parser infrastructure.

---

## Context & Motivation

KardiSynch currently manages CIED interrogation data from local files. Clinicians working with remote monitoring must separately open four manufacturer web portals (Medtronic CareLink, Biotronik Home Monitoring, Abbott Merlin.net, Boston Scientific LATITUDE), log in to each, review data, manually download PDF reports, and then import them into KardiSynch via the `_IMPORT` folder. This context-switching wastes significant time daily.

This feature adds an integrated web panel inside KardiSynch that functions as a standard Chromium browser. It does not scrape, automate, inject scripts, or modify any external website. All user interaction with external sites is manual — identical to using Chrome or Firefox. KardiSynch only acts on locally downloaded files.

---

## Architectural Decisions (Locked)

### W1: BrowserView, Not WebView Tag

Use Electron `BrowserView` (or `WebContentsView` in newer Electron versions — check which is current/non-deprecated). BrowserView renders as a full Chromium browser instance within the KardiSynch window. No iframe embedding, no content modification, no script injection.

### W2: Generic Browser With Configurable Presets

KardiSynch ships with a default set of quick-access bookmarks but does NOT hardcode manufacturer integrations. The bookmarks are user-editable. This is a browser with sensible defaults, not a Merlin.net wrapper.

### W3: OS Keychain for Credentials

Password storage via Electron `safeStorage` API, which delegates to the OS keychain (macOS Keychain, Windows DPAPI/Credential Manager, Linux libsecret). No plaintext credential storage. No custom encryption. The browser offers to save credentials like any standard browser — user-initiated, never automatic.

### W4: No Auto-Login

The keychain fills credentials into form fields. The user clicks "Login" manually. There is no automated login sequence, no programmatic form submission, no background authentication.

### W5: Download Interception is Local-Only

The `will-download` event on BrowserView's `webContents` intercepts downloads that the user manually initiated. KardiSynch does not trigger downloads, does not navigate programmatically, does not interact with the remote site in any way. Post-download processing is a local file operation.

### W6: Remote Visits Are Visually Distinct

Downloads from whitelisted domains that are assigned to patients create visits with `type: "remote"` and a distinct icon/color in the timeline, clearly differentiating them from in-person visits.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  KardiSynch                                    [─] [□] [×]  │
├────────┬────────────────────────────────────────────────────┤
│        │  ┌─────────────────────────────────────────────┐   │
│  📋    │  │ [◄] [►] [🔄]  [ URL bar                  ] │   │
│ Patients│  ├─────────────────────────────────────────────┤   │
│        │  │                                             │   │
│  📊    │  │  ┌──────────────────────────────────────┐   │   │
│ Devices│  │  │                                      │   │   │
│        │  │  │     BrowserView renders here          │   │   │
│  📅    │  │  │     (full external website)           │   │   │
│Timeline│  │  │                                      │   │   │
│        │  │  │                                      │   │   │
│  🌐    │  │  └──────────────────────────────────────┘   │   │
│ Web ◄──│  │                                             │   │
│        │  │  ┌─Quick Access──────────────────────────┐  │   │
│        │  │  │ CareLink │ HomeM │ Merlin │ LATITUDE │  │   │
│        │  │  │ SureScan │ ProMRI│ MerlinMRI│ImageRdy │  │   │
│        │  │  │ BfArM    │ FDA   │ + Add    │         │  │   │
│        │  │  └──────────────────────────────────────┘  │   │
│        │  └─────────────────────────────────────────────┘   │
└────────┴────────────────────────────────────────────────────┘
```

The left sidebar gains a new "Web" button. Clicking it replaces the main content area with the web panel. The web panel has:

1. **Navigation bar** — Back, Forward, Reload, URL input field
2. **BrowserView area** — full Chromium rendering of whatever URL is loaded
3. **Quick Access bar** — configurable buttons, docked at bottom or top (user preference). Ships with defaults for Remote Monitoring portals, MRI compatibility tools, advisory/recall databases.

---

## Quick Access Bookmarks — Default Configuration

Stored in `config/web_bookmarks.json`. User-editable via settings UI or direct file edit.

```json
{
  "bookmarks": [
    {
      "category": "Remote Monitoring",
      "items": [
        { "label": "CareLink", "url": "https://carelink.medtronic.com", "icon": "monitor" },
        { "label": "Home Monitoring", "url": "https://biotronik-homemonitoring.com", "icon": "monitor" },
        { "label": "Merlin.net", "url": "https://www.merlin.net", "icon": "monitor" },
        { "label": "LATITUDE", "url": "https://www.latitude.bostonscientific.com", "icon": "monitor" }
      ]
    },
    {
      "category": "MRI Compatibility",
      "items": [
        { "label": "SureScan", "url": "https://www.medtronic.com/us-en/healthcare-professionals/mri-resources/implantable-cardiac-devices/product-listing.html", "icon": "mri" },
        { "label": "ProMRI Check", "url": "https://www.promricheck.com", "icon": "mri" },
        { "label": "MRI Safety", "url": "https://www.cardiovascular.abbott/us/en/hcp/mri-safety.html", "icon": "mri" },
        { "label": "ImageReady", "url": "https://www.bostonscientific.com/imageready/en-EU/home.html", "icon": "mri" }
      ]
    },
    {
      "category": "Advisories & Recalls",
      "items": [
        { "label": "BfArM", "url": "https://www.bfarm.de/DE/Medizinprodukte/Aufgaben/Risikobewertung-und-Forschung/Massnahmen-von-Herstellern/_artikel.html", "icon": "alert" },
        { "label": "FDA MAUDE", "url": "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/search.cfm", "icon": "alert" }
      ]
    }
  ]
}
```

**Requirements:**
- Bookmarks are grouped by category
- User can add, remove, reorder bookmarks via a settings modal
- User can add custom bookmarks to any category or create new categories
- Icons are from the existing icon set (lucide or similar) — no manufacturer logos

---

## Credential Storage

**Technology:** Electron `safeStorage` API

**Workflow:**
1. User navigates to a site in BrowserView and logs in manually
2. BrowserView's `webContents` detects a form submission containing password fields (standard Chromium autofill detection)
3. KardiSynch shows a toast/dialog: "Save password for carelink.medtronic.com?"
4. If accepted: domain, username, encrypted password stored via `safeStorage.encryptString()`, persisted in a local credentials store (e.g., `config/credentials.enc.json` — only encrypted blobs, never plaintext)
5. On next visit to the same domain: credential fields are pre-filled. User clicks Login manually.

**Storage format:**
```json
{
  "credentials": [
    {
      "domain": "carelink.medtronic.com",
      "username": "dr.langanke",
      "password_encrypted": "<base64 safeStorage blob>",
      "updated_at": "2026-03-13T10:00:00Z"
    }
  ]
}
```

**Security requirements:**
- `safeStorage.isEncryptionAvailable()` must be checked at startup. If OS keychain is unavailable, credential storage is disabled with a user-visible warning.
- No fallback to plaintext. Ever.
- User can view saved domains (not passwords) and delete individual credentials via settings.

---

## Download Interception & Remote Visit Workflow

### Whitelist Configuration

Stored in `config/web_downloads.json`:

```json
{
  "remote_monitoring_domains": [
    "carelink.medtronic.com",
    "biotronik-homemonitoring.com",
    "www.merlin.net",
    "merlin.net",
    "latitude.bostonscientific.com",
    "www.latitude.bostonscientific.com"
  ],
  "intercept_file_types": [".pdf"],
  "auto_prompt": true
}
```

User-editable. New domains can be added.

### Download Flow

Remote monitoring portals primarily offer PDF downloads. Only `.pdf` files are intercepted for import — all other file types from any domain are handled as standard downloads.

```
User clicks "Download Report" on CareLink
        │
        ▼
Chromium fires `will-download` event on BrowserView webContents
        │
        ▼
KardiSynch checks: Is source URL domain on whitelist?
        │
        ├── NO → Standard download to user's Downloads folder. Done.
        │
        └── YES → Is file a PDF?
                │
                ├── NO → Standard download to user's Downloads folder. Done.
                │
                └── YES → Intercept:
                        │
                        ▼
                Save PDF to temp directory (e.g., app_data/temp_downloads/)
                        │
                        ▼
                Show dialog: "PDF downloaded from CareLink.
                              Assign to a patient?"
                        │
                        ├── [No, save normally] → Move to Downloads folder. Done.
                        │
                        └── [Yes, assign] →
                                │
                                ▼
                        Feed PDF into existing assignment pipeline
                        (PatientAssignmentModal) with a `source: "remote"`
                        parameter carrying origin metadata:
                          - source_domain (e.g., "carelink.medtronic.com")
                          - source_manufacturer (from domain_manufacturer_map)
                        This parameter flows through to visit creation so that
                        the resulting visit.xml gets type="remote" and the
                        timeline can visually distinguish remote visits.
```

### Remote Visit Creation

When a download is assigned via this workflow:

1. A new visit is created in the patient's directory: `Reports/PatientID/VisitID/`
2. The `visit.xml` includes additional attributes:

```xml
<visit>
  <id>V20260313-RM</id>
  <date>2026-03-13</date>
  <type>remote</type>
  <source_domain>carelink.medtronic.com</source_domain>
  <source_manufacturer>Medtronic</source_manufacturer>
  <files>
    <file>CareLink_Report_20260313.pdf</file>
  </files>
</visit>
```

3. The `source_manufacturer` is derived from the domain whitelist mapping:

```json
{
  "domain_manufacturer_map": {
    "carelink.medtronic.com": "Medtronic",
    "biotronik-homemonitoring.com": "Biotronik",
    "merlin.net": "Abbott",
    "www.merlin.net": "Abbott",
    "latitude.bostonscientific.com": "Boston Scientific",
    "www.latitude.bostonscientific.com": "Boston Scientific"
  }
}
```

4. The visit icon in the Timeline view uses a distinct visual treatment:
   - Different icon (e.g., wifi/signal icon instead of the standard visit icon)
   - Different color or badge overlay
   - Tooltip shows "Remote Monitoring — CareLink" (or respective source)

### Timeline Visual Differentiation

```
Timeline:
  ● 2026-01-15  In-person visit     [Standard icon, standard color]
  ● 2026-02-01  In-person visit     [Standard icon, standard color]
  📡 2026-02-15  Remote — CareLink   [Wifi icon, different color]
  📡 2026-03-01  Remote — HomeM      [Wifi icon, different color]
  ● 2026-03-13  In-person visit     [Standard icon, standard color]
```

The exact visual treatment (icon, color, badge) should follow the existing KardiSynch design language. The key requirement is that remote visits are instantly distinguishable from in-person visits at a glance.

---

## Implementation Briefs

### Brief WEB-1: Web Panel Shell & BrowserView Integration

**Scope:** The web panel UI — sidebar button, BrowserView creation/lifecycle, navigation bar (back/forward/reload/URL), and panel show/hide toggling.

**Input:** User clicks "Web" in sidebar.

**Output:** BrowserView renders in the main content area. User can navigate to any URL.

**Key code:**
- New sidebar entry with icon and click handler
- `WebPanel` React component with navigation bar
- BrowserView creation in main process, IPC bridge for navigation commands
- BrowserView lifecycle management (create on first open, hide/show on panel switch, destroy on app quit)
- URL bar with enter-to-navigate and display of current URL
- Back/Forward/Reload buttons bound to `webContents.goBack()` / `goForward()` / `reload()`

**Dependencies:** Electron BrowserView or WebContentsView API.

**Lines estimate:** ~300

### Brief WEB-2: Quick Access Bookmarks

**Scope:** Configurable bookmark bar, default bookmark config, settings UI for add/remove/reorder.

**Input:** `config/web_bookmarks.json`

**Output:** Rendered bookmark buttons in Quick Access bar. Settings modal for bookmark management.

**Key code:**
- `BookmarkBar` React component rendering categorized buttons
- Click handler navigates BrowserView to bookmark URL
- `BookmarkSettingsModal` — add/edit/remove bookmarks, create categories, drag-to-reorder
- JSON config loading and saving
- Ship with default bookmarks (Remote Monitoring, MRI, Advisories)

**Dependencies:** Brief WEB-1 (BrowserView must exist).

**Lines estimate:** ~250

### Brief WEB-3: Credential Storage

**Scope:** Password save/fill via Electron `safeStorage`, credential management UI.

**Input:** User logs into a site in BrowserView.

**Output:** Offer to save credentials. Pre-fill on next visit.

**Key code:**
- Detect login form submissions via `webContents` events (monitor `will-navigate` or `did-navigate` after form interaction; alternatively use `webContents.session.on('login')` for HTTP auth or inject a minimal content script that detects `<input type="password">` submission — evaluate simplest reliable approach)
- `CredentialStore` class: `save(domain, username, password)`, `get(domain)`, `delete(domain)`, `list()` — all using `safeStorage.encryptString()` / `decryptString()`
- Save prompt toast/dialog
- Auto-fill on navigation to known domain
- Settings panel: list saved domains, delete individual credentials
- Graceful degradation if `safeStorage.isEncryptionAvailable()` returns false

**Note:** Password detection in BrowserView is non-trivial because there's no native Chromium password manager integration. Evaluate whether Electron's built-in session credentials or a lightweight preload script is the cleanest approach. Do NOT inject scripts that modify page content or behavior — only observe.

**Dependencies:** Brief WEB-1.

**Lines estimate:** ~350

### Brief WEB-4: Download Interception & Patient Assignment

**Scope:** Whitelisted PDF download detection, temp file handling, assignment dialog, integration with existing `PatientAssignmentModal` via a `source: "remote"` origin parameter.

**Input:** User manually downloads a PDF from a whitelisted domain in BrowserView.

**Output:** Dialog offering patient assignment. On confirm: PDF fed into existing assignment pipeline with remote monitoring metadata attached.

**Key code:**
- Register `webContents.session.on('will-download')` handler
- Domain whitelist check against `config/web_downloads.json`
- File type filter: **PDF only** (`.pdf`) — remote monitoring portals offer PDF reports; all other file types from any domain go to standard Downloads
- Temp download directory management (`app_data/temp_downloads/`, cleanup on app quit)
- Assignment dialog React component: "Downloaded [filename] from [domain]. Assign to patient?"
- On "Yes": open `PatientAssignmentModal` directly — no parser step. Remote monitoring PDFs do not reliably match existing parser signatures (only Boston Scientific/LATITUDE PDFs are detected; CareLink, Merlin.net, and Home Monitoring PDFs would fall through to a fragile generic regex fallback). The user assigns the patient manually. The `source: "remote"` parameter carrying `source_domain` and `source_manufacturer` (from `domain_manufacturer_map`) flows through to visit creation (WEB-5).
- On "No": move to standard Downloads folder
- Temp file cleanup after assignment or rejection

**Dependencies:** Brief WEB-1 (BrowserView), existing `PatientAssignmentModal`.

**Lines estimate:** ~300

### Brief WEB-5: Remote Visit Type & Timeline Differentiation

**Scope:** New visit type `remote`, modified visit creation to accept the `source: "remote"` parameter from WEB-4, timeline visual update.

**Input:** The `source: "remote"` parameter (with `source_domain` and `source_manufacturer`) passed through the existing assignment pipeline from WEB-4.

**Output:** Visit created with `type: "remote"` and `source_domain` / `source_manufacturer` in `visit.xml`. Timeline renders remote visits with distinct icon and color.

**Key code:**
- Extend `visit.xml` schema with `type`, `source_domain`, `source_manufacturer` attributes
- `domain_manufacturer_map` lookup from config
- Visit creation function accepts optional `source` parameter; when `source.type === "remote"`, writes remote metadata to `visit.xml`
- Timeline component: conditional icon/color rendering based on `visit.type`
- Remote visit icon (wifi/signal symbol from existing icon library)
- Remote visit color/badge distinct from standard visits
- Tooltip on remote visits showing source ("Remote Monitoring — CareLink")
- Backward compatibility: existing visits without `type` attribute default to `type: "in-person"`

**Dependencies:** Brief WEB-4 (provides the `source: "remote"` parameter through the assignment pipeline), existing Timeline component.

**Lines estimate:** ~200

---

## Implementation Order

```
WEB-1 (Shell & BrowserView)
  │
  ├── WEB-2 (Bookmarks)
  │
  ├── WEB-3 (Credentials)
  │
  └── WEB-4 (Download Interception)
          │
          └── WEB-5 (Remote Visit Type)
```

WEB-1 is the foundation. WEB-2, WEB-3, and WEB-4 can be built in parallel after WEB-1. WEB-5 depends on WEB-4.

**Total estimated lines:** ~1,400 (implementation + tests across 5 briefs)

---

## Regulatory & Legal Notes

- KardiSynch's BrowserView is a standard Chromium browser. It does not automate, scrape, modify, or inject into any external website.
- All user interaction with manufacturer portals is manual and user-initiated.
- Download interception acts on local files after the user manually triggered the download. No interaction with the remote server occurs.
- Credential storage uses OS-native encryption (Keychain/DPAPI/libsecret) — the same mechanism used by Chrome, Firefox, Safari, and Edge.
- Quick Access bookmarks are user-configurable links. KardiSynch does not display manufacturer logos or trademarks beyond user-entered text labels.
- This feature does not change KardiSynch's classification: it remains a data management tool, not a medical device. The web panel opens external websites; it does not process, interpret, or act on clinical data from those websites.
