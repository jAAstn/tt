// background.js - ZeroRAM Suspender service worker
// Uses Manifest V3 service worker
// Handles automatic suspension and user commands.

// ==== Storage Keys ====
const FAVICON_FIX_DEFAULT_BATCH_SIZE = 50;

const DEFAULT_SETTINGS = {
  autoSuspendMinutes: 30, // 0 = never
  domainSuspendTimes: {}, // Speichert Domain-Zuweisungen, z.B.: {"youtube.com": 5, "github.com": 120}
  useNativeDiscard: true, // true = chrome.tabs.discard, false = placeholder page
  whitelist: [], // array of strings (exact url, domain, or regex like /^https:\/\/balbums\.st\/?$/)
  neverSuspendAudio: true, // never suspend tabs playing audio
  neverSuspendPinned: true, // never suspend pinned tabs
  neverSuspendActive: false, // never suspend active tab in each window
  rememberLastActiveTab: true, // remember last active tab when browser loses focus
  clickAnywhereToUnsuspend: false, // allow clicking anywhere on the suspended page to unsuspend
  // How a suspended tab is marked in the tab strip:
  //   'favicon'     = render the site favicon 50% transparent (default)
  //   'titlePrefix' = keep the favicon at full opacity, prefix the title with 💤
  suspendedIndicatorMode: 'favicon',
  // Favicon fix processor settings
  fixFaviconEnabled: true, // enable suspended favicon fixing
  fixFaviconBatchSize: FAVICON_FIX_DEFAULT_BATCH_SIZE, // 0 = unlimited per checkTabs batch
  fixFaviconMaxRetries: 5, // max attempts per tab to avoid infinite reloads
  suspendBatchConcurrency: 5, // batch concurrency limit for bulk operations
};

const STORAGE_KEY = 'utsSettings';
const TEMP_KEY = 'utsTempWhitelist';
const LAST_ACTIVE_TAB_KEY = 'utsLastActiveTab';

// Constant prefix for our suspended page URL to avoid repeated getURL calls
const SUSPENDED_PREFIX = chrome.runtime.getURL('suspended.html');
const DISCARD_READY_TIMEOUT_MS = 10000;
const FAVICON_CONFIRM_INTERVAL_MS = 200;
const FAVICON_CONFIRM_MAX_ATTEMPTS = 15;
const FAVICON_CAPTURE_DELAY_MS = 200;
const EXTENSION_DEFAULT_FAVICON_URLS = new Set(
  getExtensionIconPaths().map(path => chrome.runtime.getURL(path))
);

// In-memory cache for temporary whitelist
let tempWhitelist = new Set();

// Map<tabId, lastSeenTimestamp> persisted across restarts
let seenTimestamps = {};

// Track tabs that are currently being unsuspended to prevent re-suspension
let unsuspendingTabs = new Set();

// Track tabs that are being suspended and waiting for discard
let pendingDiscardTabs = new Map(); // tabId -> pending favicon/page readiness state
let suspendedFaviconReadyTabs = new Set(); // tab IDs whose suspended favicon is ready

// Track last active tab for remembering when browser loses focus
let lastActiveTabId = null;

// Track last active tab per window to handle inactive tab timestamp updates
let lastActiveTabPerWindow = new Map(); // windowId -> { tabId, timestamp }
// Track focused window transitions so we can stamp the previous window's active tab
let lastFocusedWindowId = chrome.windows.WINDOW_ID_NONE;

// Track tabs with no favicon (normally caused by lazy loaded after browser restart)
let fixFaviconTabs = new Set(); // tabId set for tabs with no favicon
// Retry counts to prevent infinite attempts: Map<tabId, count>
let fixFaviconRetryCounts = new Map();
// Event-driven re-discard queue (avoids full inactive-tab scans on frequent events)
let pendingReDiscardTabIds = new Set();
let reDiscardRetryCounts = new Map(); // Map<tabId, count>

// Alarm period (minutes)
const ALARM_PERIOD_MINUTES = 1; // must be >=1 for chrome.alarms

let running = false;

// Keep popup ports to stream bulk progress
const popupPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.add(port);
    port.onDisconnect.addListener(() => popupPorts.delete(port));
  }
});

function postBulkProgress(payload) {
  try {
    for (const p of popupPorts) {
      p.postMessage({ type: 'bulkProgress', ...payload });
    }
  } catch (_) {}
}

// Bulk cancel control
let bulkCancelToken = { cancelled: false };
function newCancelToken() {
  bulkCancelToken = { cancelled: false };
  return bulkCancelToken;
}
function cancelBulkNow() {
  bulkCancelToken.cancelled = true;
  try {
    for (const [tabId, pendingInfo] of pendingDiscardTabs) {
      if (pendingInfo && typeof pendingInfo.resolve === 'function') {
        pendingInfo.resolve();
      }
    }
  } catch (_) {}
}

// Helper: load settings
async function getSettings() {
  const { [STORAGE_KEY]: saved } = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

// Cached settings to reduce frequent storage reads
let cachedSettings = null;
let cachedAtMs = 0;
const SETTINGS_CACHE_MS = 5000;
let compiledWhitelistSource = null;
let compiledWhitelistLooseUrlPrefixes = [];
let compiledWhitelistUrlPrefixesByHost = new Map();
let compiledWhitelistDomains = new Set();

async function getSettingsCached() {
  const now = Date.now();
  if (cachedSettings && (now - cachedAtMs) < SETTINGS_CACHE_MS) {
    return cachedSettings;
  }
  cachedSettings = await getSettings();
  cachedAtMs = now;
  return cachedSettings;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    cachedSettings = { ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEY].newValue || {}) };
    cachedAtMs = Date.now();
    compiledWhitelistSource = null;
  }
});

// Helper: save settings
async function saveSettings(settings) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}

function setTempWhitelistFromStorageValue(value) {
  if (!Array.isArray(value)) {
    tempWhitelist = new Set();
    return;
  }
  const cleaned = value.filter(v => typeof v === 'string' && v.length > 0);
  tempWhitelist = new Set(cleaned);
}

async function persistTempWhitelist() {
  await chrome.storage.session.set({ [TEMP_KEY]: Array.from(tempWhitelist) });
}

// Helper: save last active tab ID
async function saveLastActiveTab() {
  await chrome.storage.session.set({ [LAST_ACTIVE_TAB_KEY]: lastActiveTabId });
}

// Helper: load last active tab ID
async function loadLastActiveTab() {
  const { [LAST_ACTIVE_TAB_KEY]: saved } = await chrome.storage.session.get(LAST_ACTIVE_TAB_KEY);
  lastActiveTabId = saved || null;
}

const LAST_ACTIVE_PER_WINDOW_KEY = 'utsLastActiveTabPerWindow';

function setLastActiveTabInWindow(windowId, data) {
  lastActiveTabPerWindow.set(windowId, data);
  chrome.storage.session.set({
    [LAST_ACTIVE_PER_WINDOW_KEY]: Object.fromEntries(lastActiveTabPerWindow)
  });
}

function removeLastActiveTabInWindow(windowId) {
  lastActiveTabPerWindow.delete(windowId);
  chrome.storage.session.set({
    [LAST_ACTIVE_PER_WINDOW_KEY]: Object.fromEntries(lastActiveTabPerWindow)
  });
}

async function loadLastActiveTabPerWindow() {
  const { [LAST_ACTIVE_PER_WINDOW_KEY]: saved } =
    await chrome.storage.session.get(LAST_ACTIVE_PER_WINDOW_KEY);
  if (saved) {
    lastActiveTabPerWindow = new Map(
      Object.entries(saved).map(([k, v]) => [Number(k), v])
    );
  }
}

// Helper: internal URL check
function isInternalUrl(url) {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about://') ||
    url.startsWith('view-source:') ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('extension://')
  );
}

function isTabGoneError(error) {
  const message = String((error && error.message) || error || '');
  return message.includes('No tab with id') || message.includes('Invalid tab ID');
}

function logUnexpectedTabError(context, error) {
  if (isTabGoneError(error)) return;
  console.warn(`[ZeroRAM Suspender] ${context}:`, error);
}

function compileWhitelist(whitelist) {
  compiledWhitelistLooseUrlPrefixes = [];
  compiledWhitelistUrlPrefixesByHost = new Map();
  compiledWhitelistDomains = new Set();
  compiledWhitelistSource = whitelist;

  if (!Array.isArray(whitelist) || whitelist.length === 0) return;

  for (const rawEntry of whitelist) {
    if (typeof rawEntry !== 'string') continue;
    const entry = rawEntry.trim();
    if (!entry) continue;

    if (entry.startsWith('/') && entry.endsWith('/') && entry.length > 2) {
      continue;
    }

    if (entry.startsWith('http')) {
      try {
        const parsed = new URL(entry);
        const host = (parsed.hostname || '').toLowerCase();
        if (host) {
          const arr = compiledWhitelistUrlPrefixesByHost.get(host);
          if (arr) {
            arr.push(entry);
          } else {
            compiledWhitelistUrlPrefixesByHost.set(host, [entry]);
          }
        } else {
          compiledWhitelistLooseUrlPrefixes.push(entry);
        }
      } catch (_) {
        compiledWhitelistLooseUrlPrefixes.push(entry);
      }
    } else {
      compiledWhitelistDomains.add(entry.toLowerCase());
    }
  }
}

function ensureCompiledWhitelist(settings) {
  const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : [];
  if (compiledWhitelistSource !== whitelist) {
    compileWhitelist(whitelist);
  }
}

function isHostnameWhitelisted(hostname) {
  if (!hostname || compiledWhitelistDomains.size === 0) return false;
  let current = hostname.toLowerCase();
  while (current) {
    if (compiledWhitelistDomains.has(current)) return true;
    const dot = current.indexOf('.');
    if (dot === -1) break;
    current = current.slice(dot + 1);
  }
  return false;
}

// Helper: whitelist check (Inklusive funktionierender RegEx Auswertung)
// Helper: whitelist check (Inklusive priorisierter und UI-sicherer RegEx-Auswertung)
function isWhitelisted(url, settings) {
  if (!url) return false;
  if (isInternalUrl(url)) return true; 
  if (tempWhitelist.has(url)) return true; 

  const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : [];
  
  // 1. Reguläre Ausdrücke (RegEx) absolut priorisiert auswerten
  for (const rawEntry of whitelist) {
    if (typeof rawEntry !== 'string') continue;
    const entry = rawEntry.trim();
    
    // Erkennt Einträge, die mit / beginnen und enden
    if (entry.startsWith('/') && entry.endsWith('/') && entry.length > 2) {
      try {
        let pattern = entry.slice(1, -1);
        
        // Toleranz-Sicherung: Falls der User vergessen hat, die Slashes in http:// zu escapen,
        // korrigieren wir das hier dynamisch, um Syntax-Fehler im RegExp-Konstruktor zu verhindern.
        if (pattern.includes('://') && !pattern.includes(':\\/\\/')) {
          pattern = pattern.replace(/:\/\//g, ':\\/\\/');
        }
        
        const regex = new RegExp(pattern, 'i');
        if (regex.test(url)) {
          return true; // Match für die UI und den Suspend-Timer!
        }
      } catch (e) {
        console.error(`[ZeroRAM Whitelist] Fehlerhafter RegEx-Eintrag: ${entry}`, e);
      }
    }
  }

  // 2. Standard-Prefix und Domain Matcher ausführen (Fallback)
  ensureCompiledWhitelist(settings);

  for (const prefix of compiledWhitelistLooseUrlPrefixes) {
    if (url.startsWith(prefix)) return true;
  }

  if (
    compiledWhitelistDomains.size === 0 &&
    compiledWhitelistUrlPrefixesByHost.size === 0
  ) {
    return false;
  }

  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();
    const hostPrefixes = compiledWhitelistUrlPrefixesByHost.get(host);
    if (hostPrefixes) {
      for (const prefix of hostPrefixes) {
        if (url.startsWith(prefix)) return true;
      }
    }
    return isHostnameWhitelisted(u.hostname);
  } catch (_) {
    return false;
  }
}

// Helper: is suspended tab
function isSuspendedTab(tab) {
  return tab && tab.url && tab.url.startsWith(SUSPENDED_PREFIX);
}

function getExtensionIconPaths() {
  const manifest = chrome.runtime.getManifest();
  const paths = new Set();
  for (const iconSet of [manifest.icons, manifest.action && manifest.action.default_icon]) {
    if (!iconSet || typeof iconSet !== 'object') continue;
    for (const path of Object.values(iconSet)) {
      if (typeof path === 'string' && path) {
        paths.add(path);
      }
    }
  }
  return Array.from(paths);
}

function stripFaviconUrlSuffix(url) {
  if (!url) return '';
  const text = String(url);
  const queryIndex = text.indexOf('?');
  const hashIndex = text.indexOf('#');
  let cutIndex = -1;
  if (queryIndex !== -1) cutIndex = queryIndex;
  if (hashIndex !== -1 && (cutIndex === -1 || hashIndex < cutIndex)) {
    cutIndex = hashIndex;
  }
  return cutIndex === -1 ? text : text.slice(0, cutIndex);
}

function isExtensionDefaultFaviconUrl(favIconUrl) {
  if (!favIconUrl) return false;
  if (EXTENSION_DEFAULT_FAVICON_URLS.has(favIconUrl)) return true;
  return EXTENSION_DEFAULT_FAVICON_URLS.has(stripFaviconUrlSuffix(favIconUrl));
}

function hasUsableSuspendedFavicon(tab) {
  return Boolean(tab && tab.favIconUrl && !isExtensionDefaultFaviconUrl(tab.favIconUrl));
}

function needsSuspendedFaviconFix(tab) {
  return Boolean(
    tab &&
    !tab.active &&
    isSuspendedTab(tab) &&
    (!tab.favIconUrl || isExtensionDefaultFaviconUrl(tab.favIconUrl))
  );
}

function parseOriginalUrlFromSuspended(suspendedUrl) {
  try {
    if (!suspendedUrl || !suspendedUrl.startsWith(SUSPENDED_PREFIX)) {
      return null;
    }
    const urlObj = new URL(suspendedUrl);
    return urlObj.searchParams.get('uri');
  } catch (error) {
    console.warn('[ZeroRAM Suspender] Failed to parse suspended URL:', error);
    return null;
  }
}

function markTabSeen(tabId, timestamp) {
  if (typeof tabId !== 'number') return false;
  seenTimestamps[tabId] = timestamp;
  return true;
}

async function markWindowActiveTabSeen(windowId, timestamp) {
  if (typeof windowId !== 'number' || windowId === chrome.windows.WINDOW_ID_NONE) {
    return false;
  }

  const tracked = lastActiveTabPerWindow.get(windowId);
  if (tracked && markTabSeen(tracked.tabId, timestamp)) {
    return true;
  }

  try {
    const activeTabs = await chrome.tabs.query({ windowId, active: true });
    if (activeTabs.length > 0 && typeof activeTabs[0].id === 'number') {
      const activeTabId = activeTabs[0].id;
      setLastActiveTabInWindow(windowId, { tabId: activeTabId, timestamp });
      return markTabSeen(activeTabId, timestamp);
    }
  } catch (_) {}
  return false;
}

// Background process for fixing tab favicon
let fixFaviconProcessor = {
  isRunning: false,
  timeoutId: null,
  
  start() {
    if (this.isRunning || fixFaviconTabs.size === 0) return;
    this.isRunning = true;
    this.processNext();
  },
  
  stop() {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  },
  
  async processNext() {
    if (!this.isRunning || fixFaviconTabs.size === 0) {
      this.isRunning = false;
      return;
    }
    
    const tabId = fixFaviconTabs.values().next().value;
    fixFaviconTabs.delete(tabId);
    let attemptedReload = false;
    
    try {
      const settings = await getSettingsCached();
      if (!settings.fixFaviconEnabled) {
        this.stop();
        return;
      }

      const tab = await chrome.tabs.get(tabId);
      if (isSuspendedTab(tab)) {
        if (!tab.active) {
          attemptedReload = true;
          if (settings.useNativeDiscard) {
            beginSuspendedReadyWait(tabId);
          }
          await chrome.tabs.reload(tabId);

          if (settings.useNativeDiscard) {
            await discardSuspendedTabWhenReady(tabId, 'Favicon fix discard');
          }
        }
      }
    } catch (error) {
      if (attemptedReload) {
        cancelPendingDiscardWait(tabId);
      }
      logUnexpectedTabError('Failed to fix tab favicon', error);
    }
    
    if (attemptedReload && !suspendedFaviconReadyTabs.has(tabId)) {
      const currentRetries = fixFaviconRetryCounts.get(tabId) || 0;
      fixFaviconRetryCounts.set(tabId, currentRetries + 1);
    }
    
    this.timeoutId = setTimeout(() => {
      this.processNext();
    }, 1000);
  }
};

// === Suspension Logic ===
async function suspendTab(tab, settings) {
  if (isInternalUrl(tab.url)) return;

  const shouldDiscard = settings.useNativeDiscard && !tab.active;
  if (shouldDiscard) {
    beginSuspendedReadyWait(tab.id);
  }

  try {
    await suspendWithPlaceholder(tab);
  } catch (error) {
    if (shouldDiscard) {
      cancelPendingDiscardWait(tab.id);
    }
    throw error;
  }

  if (shouldDiscard) {
    await discardSuspendedTabWhenReady(tab.id, 'Discard after suspend');
  }
}

function beginSuspendedReadyWait(tabId, resetReady = true) {
  if (resetReady) {
    suspendedFaviconReadyTabs.delete(tabId);
  }

  let pendingInfo = pendingDiscardTabs.get(tabId);
  if (pendingInfo) {
    clearTimeout(pendingInfo.timeoutId);
    pendingInfo.pageComplete = false;
    pendingInfo.faviconReady = false;
    pendingInfo.timedOut = false;
  } else {
    pendingInfo = {
      pageComplete: false,
      faviconReady: false,
      timedOut: false,
      generation: 0,
      timeoutId: null,
      promise: null,
      tryResolve() {
        if (this.pageComplete && this.faviconReady) {
          this.resolve({ timedOut: false });
        }
      },
      resolve(result = { timedOut: false }) {
        clearTimeout(this.timeoutId);
        pendingDiscardTabs.delete(tabId);
        this._resolve(result);
      }
    };
    pendingInfo.promise = new Promise(resolve => {
      pendingInfo._resolve = resolve;
    });
    pendingDiscardTabs.set(tabId, pendingInfo);
  }

  pendingInfo.generation += 1;
  const generation = pendingInfo.generation;
  pendingInfo.timeoutId = setTimeout(() => {
    pendingInfo.timedOut = true;
    pendingInfo.resolve({ timedOut: true });
  }, DISCARD_READY_TIMEOUT_MS);

  chrome.tabs.get(tabId).then(tab => {
    const currentPendingInfo = pendingDiscardTabs.get(tabId);
    if (
      !currentPendingInfo ||
      currentPendingInfo !== pendingInfo ||
      currentPendingInfo.generation !== generation
    ) {
      return;
    }
    if (isSuspendedTab(tab) && tab.status === 'complete') {
      currentPendingInfo.pageComplete = true;
      if (suspendedFaviconReadyTabs.has(tabId) || hasUsableSuspendedFavicon(tab)) {
        currentPendingInfo.faviconReady = true;
        suspendedFaviconReadyTabs.add(tabId);
      }
      currentPendingInfo.tryResolve();
    }
  }).catch(() => {
    const currentPendingInfo = pendingDiscardTabs.get(tabId);
    if (
      currentPendingInfo &&
      currentPendingInfo === pendingInfo &&
      currentPendingInfo.generation !== generation
    ) {
      currentPendingInfo.resolve({ tabGone: true });
    }
  });

  return pendingInfo.promise;
}

async function waitForTabLoaded(tabId, resetReady = false) {
  const pendingInfo = pendingDiscardTabs.get(tabId);
  return pendingInfo ? pendingInfo.promise : beginSuspendedReadyWait(tabId, resetReady);
}

function cancelPendingDiscardWait(tabId) {
  const pendingInfo = pendingDiscardTabs.get(tabId);
  if (pendingInfo) {
    pendingInfo.resolve({ cancelled: true });
  }
}

function markSuspendedFaviconReady(tabId) {
  if (typeof tabId !== 'number') return;
  suspendedFaviconReadyTabs.add(tabId);
  fixFaviconRetryCounts.delete(tabId);
  const pendingInfo = pendingDiscardTabs.get(tabId);
  if (pendingInfo) {
    pendingInfo.faviconReady = true;
    setTimeout(() => {
      const currentPendingInfo = pendingDiscardTabs.get(tabId);
      if (currentPendingInfo && currentPendingInfo === pendingInfo) {
        currentPendingInfo.tryResolve();
      }
    }, FAVICON_CAPTURE_DELAY_MS);
  }
}

function confirmSuspendedFaviconReady(tabId, attempt = 0) {
  if (typeof tabId !== 'number') return;
  setTimeout(async () => {
    if (suspendedFaviconReadyTabs.has(tabId)) return;
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      return;
    }
    if (!isSuspendedTab(tab)) return;
    if (hasUsableSuspendedFavicon(tab) || attempt + 1 >= FAVICON_CONFIRM_MAX_ATTEMPTS) {
      markSuspendedFaviconReady(tabId);
    } else {
      confirmSuspendedFaviconReady(tabId, attempt + 1);
    }
  }, FAVICON_CONFIRM_INTERVAL_MS);
}

async function discardSuspendedTabWhenReady(tabId, context) {
  try {
    await waitForTabLoaded(tabId);
    const currentTab = await chrome.tabs.get(tabId);
    if (!isSuspendedTab(currentTab) || currentTab.active || currentTab.discarded) {
      return false;
    }
    await chrome.tabs.discard(tabId);
    return true;
  } catch (error) {
    logUnexpectedTabError(`${context} failed`, error);
    return false;
  }
}

async function suspendWithPlaceholder(tab) {
  const suspendedUrl = SUSPENDED_PREFIX +
    `?uri=${encodeURIComponent(tab.url)}&ttl=${encodeURIComponent(tab.title)}` +
    (tab.favIconUrl ? `&favicon=${encodeURIComponent(tab.favIconUrl)}` : '');
  await chrome.tabs.update(tab.id, { url: suspendedUrl });
}

// Timer to check for inactivity
async function checkTabs() {
  const settings = await getSettingsCached();
  if (settings.autoSuspendMinutes === 0) return; // never auto suspend

  const tabs = await chrome.tabs.query({});
  
  if (!fixFaviconProcessor.isRunning) {
    fixFaviconTabs.clear();

    if (settings.fixFaviconEnabled) {
      const batchSize = Number(settings.fixFaviconBatchSize) || 0;
      let added = 0;
      for (const tab of tabs) {
        if (needsSuspendedFaviconFix(tab)) {
          const retryCount = fixFaviconRetryCounts.get(tab.id) || 0;
          if (settings.fixFaviconMaxRetries > 0 && retryCount >= settings.fixFaviconMaxRetries) {
            continue;
          }
          fixFaviconTabs.add(tab.id);
          added++;
          if (batchSize > 0 && added >= batchSize) break;
        }
      }

      if (fixFaviconTabs.size > 0) {
        fixFaviconProcessor.start();
      }
    } else {
      fixFaviconProcessor.stop();
    }
  }

  const windows = await chrome.windows.getAll();
  const focusedWindow = windows.find(w => w.focused);
  let focusedWindowActiveTabId = null;
  
  if (focusedWindow) {
    const activeTabs = await chrome.tabs.query({ windowId: focusedWindow.id, active: true });
    if (activeTabs.length > 0) {
      focusedWindowActiveTabId = activeTabs[0].id;
    }
  }
  
  const getDomainFromUrl = (url) => {
    try {
      if (!url) return null;
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase().replace('www.', '');
    } catch (_) {
      return null;
    }
  };
  
  for (const tab of tabs) {
    if (tab.discarded || isSuspendedTab(tab) || isInternalUrl(tab.url)) {
      continue;
    }
    
    if (unsuspendingTabs.has(tab.id)) {
      continue;
    }
    
    if (isWhitelisted(tab.url, settings)) continue;

    if (settings.neverSuspendAudio && tab.audible) {
      continue;
    }
    
    if (settings.neverSuspendPinned && tab.pinned) {
      continue;
    }
    
    if (settings.rememberLastActiveTab && tab.id === lastActiveTabId && !focusedWindow) {
      continue;
    }
    
    if (tab.active) {
      if (settings.neverSuspendActive) {
        continue;
      } else {
        if (tab.id === focusedWindowActiveTabId) {
          continue;
        }
      }
    }

    // Bestimmung der spezifischen Suspend-Zeit für diesen Tab
    let currentTabMinutes = settings.autoSuspendMinutes;
    const tabDomain = getDomainFromUrl(tab.url);
    
    if (tabDomain && settings.domainSuspendTimes && settings.domainSuspendTimes[tabDomain] !== undefined) {
      currentTabMinutes = Number(settings.domainSuspendTimes[tabDomain]);
    }

    if (currentTabMinutes === 0) {
      continue;
    }

    const autoSuspendTime = currentTabMinutes * 60 * 1000;

    const chromeTimestamp = tab.lastAccessed;
    const ourTimestamp = seenTimestamps[tab.id];

    let last;
    if (typeof chromeTimestamp === 'number' && typeof ourTimestamp === 'number') {
      last = Math.max(chromeTimestamp, ourTimestamp);
    } else if (typeof ourTimestamp === 'number') {
      last = ourTimestamp;
    } else if (typeof chromeTimestamp === 'number') {
      last = chromeTimestamp;
    } else {
      seenTimestamps[tab.id] = Date.now();
      continue;
    }

    if (last < (Date.now() - autoSuspendTime)) {
      try {
        await suspendTab(tab, settings);
      } catch (error) {
        logUnexpectedTabError('Failed to suspend tab during checkTabs', error);
      }
    }
  }
  saveSeenTimestamps();
}

// ==== Event Handlers ====
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await saveSettings(settings);
  const { [TEMP_KEY]: tmp = [] } = await chrome.storage.session.get(TEMP_KEY);
  setTempWhitelistFromStorageValue(tmp);
  await loadLastActiveTab();
});

(async () => {
  const { [TEMP_KEY]: tmp = [] } = await chrome.storage.session.get(TEMP_KEY);
  setTempWhitelistFromStorageValue(tmp);
  const { utsSeen = {} } = await chrome.storage.session.get('utsSeen');
  for (const [key, value] of Object.entries(utsSeen)) {
    if (!(key in seenTimestamps) || seenTimestamps[key] < value) {
      seenTimestamps[key] = value;
    }
  }
  await loadLastActiveTab();
  await loadLastActiveTabPerWindow();

  try {
    const windows = await chrome.windows.getAll();
    const currentWindowIds = new Set(windows.map(w => w.id));

    for (const winId of lastActiveTabPerWindow.keys()) {
      if (!currentWindowIds.has(winId)) {
        lastActiveTabPerWindow.delete(winId);
      }
    }

    let focusedWindowActiveTabId = null;
    const focusedWindow = windows.find(w => w.focused);
    if (lastFocusedWindowId === chrome.windows.WINDOW_ID_NONE) {
      lastFocusedWindowId = focusedWindow ? focusedWindow.id : chrome.windows.WINDOW_ID_NONE;
    }
    let needsSave = false;
    for (const window of windows) {
      const activeTabs = await chrome.tabs.query({ windowId: window.id, active: true });
      if (activeTabs.length > 0) {
        const activeTab = activeTabs[0];
        if (!lastActiveTabPerWindow.has(window.id)) {
          lastActiveTabPerWindow.set(window.id, {
            tabId: activeTab.id,
            timestamp: Date.now()
          });
          needsSave = true;
        }
        if (focusedWindow && focusedWindow.id === window.id) {
          focusedWindowActiveTabId = activeTab.id;
        }
      }
    }
    if (needsSave || lastActiveTabPerWindow.size !== currentWindowIds.size) {
      chrome.storage.session.set({
        [LAST_ACTIVE_PER_WINDOW_KEY]: Object.fromEntries(lastActiveTabPerWindow)
      });
    }
    if (focusedWindowActiveTabId && lastActiveTabId !== focusedWindowActiveTabId) {
      lastActiveTabId = focusedWindowActiveTabId;
      await saveLastActiveTab();
    }
  } catch (error) {
    console.warn('Failed to initialize per-window active tab tracking:', error);
  }
})();

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const now = Date.now();
  const { tabId, windowId } = activeInfo;
  let previousTabId = null;

  const lastActiveInWindow = lastActiveTabPerWindow.get(windowId);
  if (lastActiveInWindow && lastActiveInWindow.tabId !== tabId) {
    seenTimestamps[lastActiveInWindow.tabId] = now;
    previousTabId = lastActiveInWindow.tabId;
  }

  seenTimestamps[tabId] = now;
  saveSeenTimestamps();

  setLastActiveTabInWindow(windowId, { tabId, timestamp: now });

  if (lastActiveTabId !== tabId) {
    lastActiveTabId = tabId;
    await saveLastActiveTab();
  }
  if (previousTabId !== null) {
    scheduleReDiscard(previousTabId);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const now = Date.now();
  const previousFocusedWindowId = lastFocusedWindowId;
  lastFocusedWindowId = windowId;

  try {
    let seenUpdated = false;

    if (
      previousFocusedWindowId !== chrome.windows.WINDOW_ID_NONE &&
      previousFocusedWindowId !== windowId
    ) {
      seenUpdated = await markWindowActiveTabSeen(previousFocusedWindowId, now);
    }

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      if (seenUpdated) saveSeenTimestamps();
      await saveLastActiveTab();
      return;
    }
    const activeTabs = await chrome.tabs.query({ windowId, active: true });
    if (activeTabs.length > 0) {
      const activeTabId = activeTabs[0].id;
      setLastActiveTabInWindow(windowId, { tabId: activeTabId, timestamp: now });
      if (lastFocusedWindowId === windowId && lastActiveTabId !== activeTabId) {
        lastActiveTabId = activeTabId;
        await saveLastActiveTab();
      }
    }
    if (seenUpdated) saveSeenTimestamps();
  } catch (e) {
    console.warn('onFocusChanged handler failed:', e);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    if (changeInfo.url.startsWith(SUSPENDED_PREFIX)) {
      suspendedFaviconReadyTabs.delete(tabId);
    } else {
      suspendedFaviconReadyTabs.delete(tabId);
      cancelPendingDiscardWait(tabId);
    }
  }

  if (
    changeInfo.favIconUrl &&
    isSuspendedTab(tab) &&
    !isExtensionDefaultFaviconUrl(changeInfo.favIconUrl)
  ) {
    markSuspendedFaviconReady(tabId);
  }

  if (changeInfo.status === 'complete') {
    seenTimestamps[tabId] = Date.now();
    saveSeenTimestamps();
    
    if (unsuspendingTabs.has(tabId)) {
      unsuspendingTabs.delete(tabId);
    }
    
    if (fixFaviconTabs.has(tabId)) {
      fixFaviconTabs.delete(tabId);
    }
    const suspended = isSuspendedTab(tab);
    if (suspended && hasUsableSuspendedFavicon(tab)) {
      suspendedFaviconReadyTabs.add(tabId);
      fixFaviconRetryCounts.delete(tabId);
    }
    
    const pendingInfo = pendingDiscardTabs.get(tabId);
    if (pendingInfo && suspended) {
      pendingInfo.pageComplete = true;
      if (suspendedFaviconReadyTabs.has(tabId) || hasUsableSuspendedFavicon(tab)) {
        pendingInfo.faviconReady = true;
        suspendedFaviconReadyTabs.add(tabId);
      }
      pendingInfo.tryResolve();
    }

    if (!pendingInfo && suspended && !tab.active && !tab.discarded) {
      scheduleReDiscard(tabId);
    }
  }
  
  if (changeInfo.active === false) {
    seenTimestamps[tabId] = Date.now();
    saveSeenTimestamps();
    if (!pendingDiscardTabs.has(tabId)) {
      scheduleReDiscard(tabId);
    }
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  const now = Date.now();
  try {
    if (typeof tab.openerTabId === 'number') {
      seenTimestamps[tab.openerTabId] = now;
      saveSeenTimestamps();
    }

    const lastActiveInWindow = lastActiveTabPerWindow.get(tab.windowId);
    if (lastActiveInWindow && lastActiveInWindow.tabId !== tab.id) {
      seenTimestamps[lastActiveInWindow.tabId] = now;
      saveSeenTimestamps();
    }

    if (tab.active) {
      if (lastActiveTabId !== tab.id) {
        lastActiveTabId = tab.id;
        await saveLastActiveTab();
      }
      setLastActiveTabInWindow(tab.windowId, { tabId: tab.id, timestamp: now });
    }
  } catch (e) {
    console.warn('onCreated handler failed:', e);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  unsuspendingTabs.delete(tabId);
  fixFaviconTabs.delete(tabId);
  fixFaviconRetryCounts.delete(tabId);
  suspendedFaviconReadyTabs.delete(tabId);
  pendingReDiscardTabIds.delete(tabId);
  reDiscardRetryCounts.delete(tabId);
  cancelPendingDiscardWait(tabId);

  const { windowId } = removeInfo;
  const lastActiveInWindow = lastActiveTabPerWindow.get(windowId);
  if (lastActiveInWindow && lastActiveInWindow.tabId === tabId) {
    removeLastActiveTabInWindow(windowId);
  }

  delete seenTimestamps[tabId];
  saveSeenTimestamps();
});

// Communication handling
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const respond = (payload) => {
    try {
      sendResponse(payload);
    } catch (_) {}
  };

  (async () => {
    try {
      if (msg.command === 'suspendTab') {
        const tab = await chrome.tabs.get(msg.tabId);
        const settings = await getSettings();
        await suspendTab(tab, settings);
        respond({ done: true });
      } else if (msg.command === 'unsuspendTab') {
        await unsuspendTabWithUrl(msg.tabId, msg.originalUrl);
        respond({ done: true });
      } else if (msg.command === 'suspendOthers') {
        await suspendOthersInWindow(msg.tabId, false);
        respond({ done: true });
      } else if (msg.command === 'unsuspendAll') {
        await unsuspendAllTabs(!!msg.withProgress);
        respond({ done: true });
      } else if (msg.command === 'unsuspendAllThisWindow') {
        const currentTab = await chrome.tabs.get(msg.tabId);
        await unsuspendAllTabsInWindow(currentTab.windowId);
        respond({ done: true });
      } else if (msg.command === 'updateSettings') {
        await saveSettings(msg.settings);
        respond({ done: true });
      } else if (msg.command === 'toggleTempWhitelist') {
        const url = msg.url;
        if (tempWhitelist.has(url)) {
          tempWhitelist.delete(url);
        } else {
          tempWhitelist.add(url);
        }
        await persistTempWhitelist();
        respond({ whitelisted: tempWhitelist.has(url) });
      } else if (msg.command === 'checkTempWhitelist') {
        const whitelisted = tempWhitelist.has(msg.url);
        respond({ whitelisted });
      } else if (msg.command === 'suspendSelectedTabs') {
        await suspendSelectedTabs(msg.tabIds);
        respond({ done: true });
      } else if (msg.command === 'unsuspendSelectedTabs') {
        await unsuspendSelectedTabs(msg.tabIds);
        respond({ done: true });
      } else if (msg.command === 'suspendAllOthersAllWindows') {
        await suspendOthersInAllWindows(msg.tabId, !!msg.withProgress, false);
        respond({ done: true });
      } else if (msg.command === 'cancelBulk') {
        cancelBulkNow();
        respond({ done: true });
      } else if (msg.command === 'faviconReady') {
        const tabId = sender.tab ? sender.tab.id : null;
        if (typeof tabId === 'number') {
          const settings = await getSettingsCached();
          if (settings.useNativeDiscard) {
            confirmSuspendedFaviconReady(tabId);
          }
        }
        respond({ done: true });
      } else if (msg.command === 'startUnsuspending') {
        const tabId = sender.tab ? sender.tab.id : msg.tabId;
        if (tabId) {
          unsuspendingTabs.add(tabId);
        }
        respond({ done: true });
      } else if (msg.command === 'unsuspendNavigate') {
        const tabId = sender.tab ? sender.tab.id : null;
        if (tabId && msg.url) {
          await chrome.tabs.update(tabId, { url: msg.url });
          respond({ done: true });
        } else {
          respond({ done: false, error: 'Missing tab or url' });
        }
      } else {
        respond({ done: false, error: 'Unknown command' });
      }
    } catch (error) {
      logUnexpectedTabError(`Message command failed (${msg && msg.command})`, error);
      respond({
        done: false,
        error: isTabGoneError(error)
          ? 'Tab no longer exists'
          : String((error && error.message) || error || 'Unknown error')
      });
    }
  })();
  return true;
});

function scheduleCheckAlarm() {
  chrome.alarms.create('utsAutoCheck', { periodInMinutes: ALARM_PERIOD_MINUTES });
}

chrome.runtime.onInstalled.addListener(scheduleCheckAlarm);
chrome.runtime.onStartup.addListener(scheduleCheckAlarm);

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== 'utsAutoCheck') return;
  if (running) return;
  running = true;
  try {
    await checkTabs();
  } catch (error) {
    logUnexpectedTabError('Auto check failed', error);
  } finally {
    running = false;
  }
});

self.addEventListener('beforeunload', () => {
  fixFaviconProcessor.stop();
  flushSeenTimestampsNow();
});

chrome.runtime.onSuspend?.addListener(() => {
  fixFaviconProcessor.stop();
  flushSeenTimestampsNow();
});

async function processQueuedReDiscardTabs() {
  const settings = await getSettingsCached();
  if (!settings.useNativeDiscard) {
    pendingReDiscardTabIds.clear();
    reDiscardRetryCounts.clear();
    return;
  }

  const configuredBatchSize = Number(settings.fixFaviconBatchSize) || 0;
  const batchSize = configuredBatchSize > 0
    ? Math.max(1, Math.floor(configuredBatchSize))
    : pendingReDiscardTabIds.size;
  if (batchSize <= 0 || pendingReDiscardTabIds.size === 0) return;

  const maxRetries = Number(settings.fixFaviconMaxRetries) || 0;
  const candidates = Array.from(pendingReDiscardTabIds).slice(0, batchSize);
  for (const tabId of candidates) {
    pendingReDiscardTabIds.delete(tabId);

    if (unsuspendingTabs.has(tabId)) {
      reDiscardRetryCounts.delete(tabId);
      continue;
    }

    if (pendingDiscardTabs.has(tabId)) {
      reDiscardRetryCounts.delete(tabId);
      continue;
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!isSuspendedTab(tab) || tab.discarded) {
        reDiscardRetryCounts.delete(tabId);
        continue;
      }

      if (tab.active) {
        reDiscardRetryCounts.delete(tabId);
        continue;
      }

      if (await discardSuspendedTabWhenReady(tabId, 'Scheduled re-discard')) {
        reDiscardRetryCounts.delete(tabId);
      } else {
        const latestTab = await chrome.tabs.get(tabId).catch(() => null);
        if (!latestTab || !isSuspendedTab(latestTab) || latestTab.discarded || latestTab.active) {
          reDiscardRetryCounts.delete(tabId);
          continue;
        }
        const nextRetry = (reDiscardRetryCounts.get(tabId) || 0) + 1;
        if (maxRetries > 0 && nextRetry >= maxRetries) {
          reDiscardRetryCounts.delete(tabId);
        } else {
          reDiscardRetryCounts.set(tabId, nextRetry);
          pendingReDiscardTabIds.add(tabId);
        }
      }
    } catch (e) {
      const message = String((e && e.message) || '');
      if (message.includes('No tab with id') || message.includes('Invalid tab ID')) {
        reDiscardRetryCounts.delete(tabId);
        continue;
      }

      const nextRetry = (reDiscardRetryCounts.get(tabId) || 0) + 1;
      if (maxRetries > 0 && nextRetry >= maxRetries) {
        reDiscardRetryCounts.delete(tabId);
        continue;
      }
      reDiscardRetryCounts.set(tabId, nextRetry);
      pendingReDiscardTabIds.add(tabId);
    }
  }
}

async function unsuspendTabById(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (isSuspendedTab(tab)) {
    const original = parseOriginalUrlFromSuspended(tab.url);
    if (original) {
      unsuspendingTabs.add(tabId);
      seenTimestamps[tabId] = Date.now();
      saveSeenTimestamps();
      await chrome.tabs.update(tabId, { url: original });
      return true;
    }
  }
  return false;
}

async function unsuspendTabWithUrl(tabId, originalUrl) {
  unsuspendingTabs.add(tabId);
  seenTimestamps[tabId] = Date.now();
  saveSeenTimestamps();
  await chrome.tabs.update(tabId, { url: originalUrl });
}

// Bulk-Fenster-Suspending (Unterstützt force-Flag zur Shortcut-Verarbeitung)
async function suspendOthersInWindow(currentTabId, force = false) {
  const currentTab = await chrome.tabs.get(currentTabId);
  const tabs = await chrome.tabs.query({ windowId: currentTab.windowId });
  const settings = await getSettingsCached();
  
  const targets = [];
  for (const tab of tabs) {
    if (tab.id !== currentTabId && !tab.active && !isInternalUrl(tab.url)) {
      if (isSuspendedTab(tab)) continue;
      
      if (!force) {
        if (settings.neverSuspendAudio && tab.audible) continue;
        if (settings.neverSuspendPinned && tab.pinned) continue;
        if (isWhitelisted(tab.url, settings)) continue;
      }
      targets.push(tab);
    }
  }

  const concurrency = settings.suspendBatchConcurrency || 5;
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(tab => suspendTab(tab, settings)));
  }
}

// Bulk-All-Windows-Suspending (Unterstützt force-Flag zur Shortcut-Verarbeitung)
async function suspendOthersInAllWindows(currentTabId, withProgress = false, force = false) {
  const allTabs = await chrome.tabs.query({});
  const settings = await getSettingsCached();
  
  const windows = await chrome.windows.getAll();
  const focusedWindow = windows.find(w => w.focused);
  let focusedWindowActiveTabId = null;
  
  if (focusedWindow) {
    const activeTabs = await chrome.tabs.query({ windowId: focusedWindow.id, active: true });
    if (activeTabs.length > 0) {
      focusedWindowActiveTabId = activeTabs[0].id;
      if (lastActiveTabId !== focusedWindowActiveTabId) {
        lastActiveTabId = focusedWindowActiveTabId;
        await saveLastActiveTab();
      }
    }
  }
  
  const targets = [];
  for (const tab of allTabs) {
    if (tab.id === currentTabId || isInternalUrl(tab.url)) continue;
    if (isSuspendedTab(tab)) continue;

    if (!force) {
      if (settings.neverSuspendAudio && tab.audible) continue;
      if (settings.neverSuspendPinned && tab.pinned) continue;
      if (isWhitelisted(tab.url, settings)) continue;
      if (settings.rememberLastActiveTab && tab.id === lastActiveTabId && !focusedWindow) continue;
      if (tab.active) {
        if (settings.neverSuspendActive) continue;
        if (tab.id === focusedWindowActiveTabId) continue;
      }
    }
    targets.push(tab);
  }

  const cancelToken = newCancelToken();
  const total = targets.length;
  let processed = 0;

  const concurrency = settings.suspendBatchConcurrency || 5;
  for (let i = 0; i < targets.length; i += concurrency) {
    if (cancelToken.cancelled) break;
    const batch = targets.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(tab =>
      suspendTab(tab, settings).finally(() => {
        processed += 1;
        if (withProgress) postBulkProgress({ action: 'suspendAll', processed, total });
      })
    ));
  }
  if (withProgress) postBulkProgress({ action: 'suspendAll', processed, total, done: true, cancelled: cancelToken.cancelled });
}

async function unsuspendAllTabs(withProgress = false) {
  const tabs = await chrome.tabs.query({});
  const targets = tabs.filter(t => isSuspendedTab(t));
  const cancelToken = newCancelToken();
  const total = targets.length;
  let processed = 0;
  for (const tab of targets) {
    if (cancelToken.cancelled) break;
    const original = parseOriginalUrlFromSuspended(tab.url);
    if (original) {
      unsuspendingTabs.add(tab.id);
      seenTimestamps[tab.id] = Date.now();
      await chrome.tabs.update(tab.id, { url: original });
    }
    processed += 1;
    if (withProgress) postBulkProgress({ action: 'unsuspendAll', processed, total });
  }
  saveSeenTimestamps();
  if (withProgress) postBulkProgress({ action: 'unsuspendAll', processed, total, done: true, cancelled: cancelToken.cancelled });
}

async function unsuspendAllTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId: windowId });
  for (const tab of tabs) {
    if (isSuspendedTab(tab)) {
      const original = parseOriginalUrlFromSuspended(tab.url);
      if (original) {
        unsuspendingTabs.add(tab.id);
        seenTimestamps[tab.id] = Date.now();
        await chrome.tabs.update(tab.id, { url: original });
      }
    }
  }
  saveSeenTimestamps();
}

async function suspendSelectedTabs(tabIds) {
  const settings = await getSettingsCached();
  const targets = [];
  for (const tabId of tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!isInternalUrl(tab.url)) {
        targets.push(tab);
      }
    } catch (error) {
      console.warn(`Failed to get tab ${tabId}:`, error);
    }
  }

  const concurrency = settings.suspendBatchConcurrency || 5;
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(tab => suspendTab(tab, settings)));
  }
}

async function unsuspendSelectedTabs(tabIds) {
  for (const tabId of tabIds) {
    try {
      await unsuspendTabById(tabId);
    } catch (error) {
      console.warn(`Failed to unsuspend tab ${tabId}:`, error);
    }
  }
}

async function toggleTabSuspension(tab) {
  if (isSuspendedTab(tab)) {
    return await unsuspendTabById(tab.id);
  } else {
    const settings = await getSettingsCached();
    if (tab && tab.url && !isInternalUrl(tab.url)) {
      await suspendTab(tab, settings);
      return true;
    }
  }
  return false;
}

let seenSaveTimer = null;
let seenSaveDirty = false;
const SEEN_SAVE_DEBOUNCE_MS = 2000;

function saveSeenTimestamps() {
  seenSaveDirty = true;
  if (seenSaveTimer) return;
  seenSaveTimer = setTimeout(() => {
    if (seenSaveDirty) {
      chrome.storage.session.set({ utsSeen: seenTimestamps });
      seenSaveDirty = false;
    }
    seenSaveTimer = null;
  }, SEEN_SAVE_DEBOUNCE_MS);
}

function flushSeenTimestampsNow() {
  if (seenSaveTimer) {
    clearTimeout(seenSaveTimer);
    seenSaveTimer = null;
  }
  if (seenSaveDirty) {
    chrome.storage.session.set({ utsSeen: seenTimestamps });
    seenSaveDirty = false;
  }
}

let reDiscardScheduled = false;
let reDiscardRunning = false;
function scheduleReDiscard(tabId = null, delayMs = 500) {
  if (typeof tabId === 'number') {
    pendingReDiscardTabIds.add(tabId);
  }

  if (reDiscardScheduled) return;
  reDiscardScheduled = true;
  setTimeout(async () => {
    reDiscardScheduled = false;

    if (reDiscardRunning) {
      if (pendingReDiscardTabIds.size > 0) {
        scheduleReDiscard(null, 250);
      }
      return;
    }

    reDiscardRunning = true;
    try {
      await processQueuedReDiscardTabs();
    } catch (e) {
      console.warn('Scheduled re-discard failed', e);
    } finally {
      reDiscardRunning = false;
      if (pendingReDiscardTabIds.size > 0) {
        scheduleReDiscard(null, 500);
      }
    }
  }, delayMs);
}

// ==== Keyboard Shortcuts / Commands API ====
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    const settings = await getSettingsCached();

    switch (command) {
      case '01-toggle-suspend':
        await toggleTabSuspension(tab);
        break;

      case '02-toggle-pause-suspend':
        if (tempWhitelist.has(tab.url)) {
          tempWhitelist.delete(tab.url);
        } else {
          tempWhitelist.add(tab.url);
        }
        await persistTempWhitelist();
        break;

      case '03-suspend-selected':
        const selectedTabsToSuspend = await chrome.tabs.query({ highlighted: true, currentWindow: true });
        for (const t of selectedTabsToSuspend) {
          if (!isSuspendedTab(t) && !isInternalUrl(t.url)) {
            await suspendTab(t, settings);
          }
        }
        break;

      case '04-unsuspend-selected':
        const selectedTabsToUnsuspend = await chrome.tabs.query({ highlighted: true, currentWindow: true });
        for (const t of selectedTabsToUnsuspend) {
          if (isSuspendedTab(t)) {
            await unsuspendTabById(t.id);
          }
        }
        break;

      case '05-suspend-others-window':
        await suspendOthersInWindow(tab.id, false);
        break;

      case '06-force-suspend-others-window':
        await suspendOthersInWindow(tab.id, true);
        break;

      case '07-suspend-all-all-windows':
        await suspendOthersInAllWindows(tab.id, false, false);
        break;

      case '08-force-suspend-all-all-windows':
        await suspendOthersInAllWindows(tab.id, false, true);
        break;
    }
  } catch (error) {
    console.error(`[ZeroRAM Shortcuts] Fehler bei Ausführung von ${command}:`, error);
  }
});

// ==== Test-only export ====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SETTINGS,
    STORAGE_KEY,
    TEMP_KEY,
    LAST_ACTIVE_TAB_KEY,
    SUSPENDED_PREFIX,
    ALARM_PERIOD_MINUTES,
    DISCARD_READY_TIMEOUT_MS,
    FAVICON_CONFIRM_INTERVAL_MS,
    FAVICON_CONFIRM_MAX_ATTEMPTS,
    FAVICON_CAPTURE_DELAY_MS,
    EXTENSION_DEFAULT_FAVICON_URLS,
    isInternalUrl,
    isTabGoneError,
    logUnexpectedTabError,
    compileWhitelist,
    ensureCompiledWhitelist,
    isHostnameWhitelisted,
    isWhitelisted,
    isSuspendedTab,
    getExtensionIconPaths,
    stripFaviconUrlSuffix,
    isExtensionDefaultFaviconUrl,
    hasUsableSuspendedFavicon,
    needsSuspendedFaviconFix,
    parseOriginalUrlFromSuspended,
    markTabSeen,
    getSettings,
    getSettingsCached,
    saveSettings,
    setTempWhitelistFromStorageValue,
    persistTempWhitelist,
    saveLastActiveTab,
    loadLastActiveTab,
    setLastActiveTabInWindow,
    removeLastActiveTabInWindow,
    loadLastActiveTabPerWindow,
    markWindowActiveTabSeen,
    saveSeenTimestamps,
    flushSeenTimestampsNow,
    suspendTab,
    suspendWithPlaceholder,
    beginSuspendedReadyWait,
    waitForTabLoaded,
    cancelPendingDiscardWait,
    markSuspendedFaviconReady,
    confirmSuspendedFaviconReady,
    discardSuspendedTabWhenReady,
    fixFaviconProcessor,
    checkTabs,
    scheduleCheckAlarm,
    scheduleReDiscard,
    processQueuedReDiscardTabs,
    postBulkProgress,
    newCancelToken,
    cancelBulkNow,
    unsuspendTabById,
    unsuspendTabWithUrl,
    suspendOthersInWindow,
    suspendOthersInAllWindows,
    unsuspendAllTabs,
    unsuspendAllTabsInWindow,
    suspendSelectedTabs,
    unsuspendSelectedTabs,
    toggleTabSuspension,
    __getInternals: () => ({
      tempWhitelist,
      seenTimestamps,
      unsuspendingTabs,
      pendingDiscardTabs,
      suspendedFaviconReadyTabs,
      lastActiveTabId,
      lastActiveTabPerWindow,
      lastFocusedWindowId,
      fixFaviconTabs,
      fixFaviconRetryCounts,
      pendingReDiscardTabIds,
      reDiscardRetryCounts,
      cachedSettings,
      popupPorts,
      bulkCancelToken,
      running,
    }),
    __setState: (patch = {}) => {
      if ('lastActiveTabId' in patch) lastActiveTabId = patch.lastActiveTabId;
      if ('lastFocusedWindowId' in patch) lastFocusedWindowId = patch.lastFocusedWindowId;
      if ('running' in patch) running = patch.running;
      if ('cachedSettings' in patch) cachedSettings = patch.cachedSettings;
      if ('cachedAtMs' in patch) cachedAtMs = patch.cachedAtMs;
    },
  };
}