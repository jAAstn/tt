// options.js - handle save/load settings with modern UI navigation
const STORAGE_KEY = 'utsSettings';
const CACHE_THEME_KEY = 'utsCacheThemeMode';
const VALID_THEME_MODES = new Set(['auto', 'light', 'dark']);
const VALID_INDICATOR_MODES = new Set(['favicon', 'titlePrefix']);
const FAVICON_FIX_DEFAULT_BATCH_SIZE = 50;

// Shared command description map for i18n lookups
const COMMAND_DESCRIPTIONS = {
  '01-toggle-suspend': { key: 'shortcutToggleSuspend', default: 'Suspend/Unsuspend current tab' },
  '02-suspend-others-window': { key: 'suspendOthers', default: 'Suspend all other tabs (this window)' },
  '03-suspend-others-all': { key: 'suspendAllOthersAllWindows', default: 'Suspend all other tabs (all windows)' },
  '04-unsuspend-all-window': { key: 'unsuspendAllThisWindow', default: 'Unsuspend all tabs (this window)' },
  '05-unsuspend-all': { key: 'unsuspendAll', default: 'Unsuspend all tabs (all windows)' }
};

const SUSPENDED_TABS_RENDER_BATCH_SIZE = 120;
const TAB_VIEWER_FILTER_SUSPENDED_ALL = 'suspended-all';
const TAB_VIEWER_FILTER_SUSPENDED_UNDISCARDED = 'suspended-undiscarded';
const TAB_VIEWER_FILTER_NOT_SUSPENDED = 'not-suspended';
const suspendedTabsViewerState = {
  renderToken: 0,
  eventsBound: false,
  stats: {
    totalTabs: 0,
    suspendedCount: 0,
    discardedCount: 0,
    undiscardedSuspendedCount: 0,
    unsuspendedCount: 0,
    matchedCount: 0,
    filterMode: TAB_VIEWER_FILTER_SUSPENDED_ALL
  }
};

// Initialize DOM elements after DOM is loaded
let autoSuspendEl, discardEl, whitelistEl, neverSuspendAudioEl, neverSuspendPinnedEl, neverSuspendActiveEl, rememberLastActiveTabEl, clickAnywhereToUnsuspendEl, themeModeEl;
let fixFaviconEnabledEl, fixFaviconBatchSizeEl, fixFaviconMaxRetriesEl, suspendBatchConcurrencyEl, suspendedIndicatorModeEl, domainSuspendTimesEl, domainJsonErrorEl;

function initializeElements() {
  autoSuspendEl = document.getElementById('autoSuspend');
  discardEl = document.getElementById('nativeDiscard');
  whitelistEl = document.getElementById('whitelistList');
  neverSuspendAudioEl = document.getElementById('neverSuspendAudio');
  neverSuspendPinnedEl = document.getElementById('neverSuspendPinned');
  neverSuspendActiveEl = document.getElementById('neverSuspendActive');
  rememberLastActiveTabEl = document.getElementById('rememberLastActiveTab');
  clickAnywhereToUnsuspendEl = document.getElementById('clickAnywhereToUnsuspend');
  themeModeEl = document.getElementById('themeMode');
  suspendedIndicatorModeEl = document.getElementById('suspendedIndicatorMode');
  fixFaviconEnabledEl = document.getElementById('fixFaviconEnabled');
  fixFaviconBatchSizeEl = document.getElementById('fixFaviconBatchSize');
  fixFaviconMaxRetriesEl = document.getElementById('fixFaviconMaxRetries');
  suspendBatchConcurrencyEl = document.getElementById('suspendBatchConcurrency');
  domainSuspendTimesEl = document.getElementById('domainSuspendTimes');
  domainJsonErrorEl = document.getElementById('domainJsonError');
}

function normalizeThemeMode(themeMode) {
  return VALID_THEME_MODES.has(themeMode) ? themeMode : 'auto';
}

function normalizeIndicatorMode(mode) {
  return VALID_INDICATOR_MODES.has(mode) ? mode : 'favicon';
}

function cacheThemeMode(themeMode) {
  try {
    localStorage.setItem(CACHE_THEME_KEY, normalizeThemeMode(themeMode));
  } catch (e) {
    console.warn('[ZeroRAM Suspender] Failed to cache theme in localStorage:', e);
  }
}

/* ---------- Overlay Notice mechanism ---------- */
/**
 * Create or retrieve the global notice container.
 */
function getNoticeContainer() {
  let container = document.getElementById('notice-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notice-container';
    container.className = 'notice-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Show a notice overlay with optional type and duration.
 * type: 'success' | 'error' | 'warning' | 'info'
 */
function showNotice(message, type = 'info', duration = 3000) {
  const container = getNoticeContainer();
  const notice = document.createElement('div');
  notice.className = `notice notice-${type}`;

  // Message span
  const msg = document.createElement('span');
  msg.className = 'notice-message';
  msg.textContent = message;
  notice.appendChild(msg);

  // Progress bar
  const progress = document.createElement('div');
  progress.className = 'notice-progress';
  progress.style.width = '100%';
  progress.style.transition = `width ${duration}ms linear`;
  notice.appendChild(progress);

  container.appendChild(notice);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progress.style.width = '0%';
    });
  });

  setTimeout(() => {
    if (progress.style.width !== '0%') {
      progress.style.width = '0%';
    }
  }, 50);
  
  const close = () => {
    notice.classList.add('hide');
    setTimeout(() => notice.remove(), 250);
  };
  setTimeout(close, duration);
}
/* ---------- End Overlay Notice mechanism ---------- */

// Navigation functionality
function initNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('.content-section');
  const actionBar = document.querySelector('.action-bar');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      navLinks.forEach(l => l.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      
      link.classList.add('active');
      
      const sectionId = link.getAttribute('data-section');
      const targetSection = document.getElementById(sectionId);
      if (targetSection) {
        targetSection.classList.add('active');
      }
      
      if (sectionId === 'migration') {
        resetMigrationState();
      }
      
      if (sectionId === 'whitelist') {
        loadWhitelist(false);
      }
      
      if (sectionId === 'changelog') {
        loadChangelog();
      }
      
      if (sectionId === 'shortcuts') {
        loadKeyboardShortcuts();
      }
      
      if (sectionId === 'session') {
        resetSessionPreviews();
      }
      
      if (sectionId === 'settings') {
        resetSettingsPreviews();
      }
      
      if (sectionId === 'tabviewer') {
        resetSuspendedTabsInfo();
      }
      
      if (sectionId === 'about' || sectionId === 'migration' || sectionId === 'changelog' || sectionId === 'shortcuts' || sectionId === 'session' || sectionId === 'settings' || sectionId === 'tabviewer') {
        actionBar.style.display = 'none';
      } else {
        actionBar.style.display = 'flex';
      }
    });
  });
}

// Set version dynamically
function setVersion() {
  const manifest = chrome.runtime.getManifest();
  const versionEl = document.getElementById('version');
  if (versionEl) {
    versionEl.textContent = manifest.version;
  }
}

// Load settings from storage
function load() {
  chrome.storage.sync.get(STORAGE_KEY, data => {
    const cfg = data[STORAGE_KEY] || {};
    autoSuspendEl.value = cfg.autoSuspendMinutes != null ? cfg.autoSuspendMinutes : 30;
    discardEl.checked = cfg.useNativeDiscard !== false;
    whitelistEl.value = (cfg.whitelist || []).join('\n');
    neverSuspendAudioEl.checked = cfg.neverSuspendAudio !== false;
    neverSuspendPinnedEl.checked = cfg.neverSuspendPinned !== false;
    neverSuspendActiveEl.checked = cfg.neverSuspendActive === true;
    rememberLastActiveTabEl.checked = cfg.rememberLastActiveTab !== false;
    clickAnywhereToUnsuspendEl.checked = cfg.clickAnywhereToUnsuspend === true;
    themeModeEl.value = normalizeThemeMode(cfg.themeMode);
    suspendedIndicatorModeEl.value = normalizeIndicatorMode(cfg.suspendedIndicatorMode);
    fixFaviconEnabledEl.checked = cfg.fixFaviconEnabled !== false;
    fixFaviconBatchSizeEl.value = (typeof cfg.fixFaviconBatchSize === 'number' ? cfg.fixFaviconBatchSize : FAVICON_FIX_DEFAULT_BATCH_SIZE);
    fixFaviconMaxRetriesEl.value = (typeof cfg.fixFaviconMaxRetries === 'number' ? cfg.fixFaviconMaxRetries : 5);
    suspendBatchConcurrencyEl.value = (typeof cfg.suspendBatchConcurrency === 'number' ? cfg.suspendBatchConcurrency : 5);
    
    // Domain-spezifische Zeiten in die Textarea laden
    if (domainSuspendTimesEl) {
      const timesObj = cfg.domainSuspendTimes || {};
      domainSuspendTimesEl.value = JSON.stringify(timesObj, null, 2);
    }
    
    // Hide error message if present
    if (domainJsonErrorEl) {
      domainJsonErrorEl.style.display = 'none';
    }
  });
}

// Load only whitelist from storage
function loadWhitelist(showNotification = true) {
  chrome.storage.sync.get(STORAGE_KEY, data => {
    const cfg = data[STORAGE_KEY] || {};
    whitelistEl.value = (cfg.whitelist || []).join('\n');
    if (showNotification) {
      showNotice(getMessage('whitelistRefreshed') || 'Whitelist refreshed', 'success', 2000);
    }
  });
}

// Get currently active section
function getCurrentActiveSection() {
  const activeSection = document.querySelector('.content-section.active');
  return activeSection ? activeSection.id : null;
}

// Save settings to storage (only current active section)
function save() {
  const currentSection = getCurrentActiveSection();
  
  // Domain-spezifische Zeiten auslesen und validieren (für alle Sektionen, die Einstellungen speichern)
  let parsedDomainTimes = {};
  const isSettingsSection = currentSection === 'basic' || currentSection === 'advanced' || !currentSection || currentSection === 'whitelist';
  
  if (isSettingsSection && domainSuspendTimesEl) {
    const rawValue = domainSuspendTimesEl.value.trim();
    if (rawValue) {
      try {
        parsedDomainTimes = JSON.parse(rawValue);
        // Validate that it's an object
        if (typeof parsedDomainTimes !== 'object' || Array.isArray(parsedDomainTimes)) {
          throw new Error('DomainSuspendTimes must be an object');
        }
        if (domainJsonErrorEl) domainJsonErrorEl.style.display = 'none';
      } catch (e) {
        if (domainJsonErrorEl) domainJsonErrorEl.style.display = 'block';
        showNotice(getMessage('invalidJsonFormat') || 'Error: Invalid JSON format for domain-specific times!', 'error', 5000);
        return; // Stops saving if JSON is invalid
      }
    } else {
      parsedDomainTimes = {};
      if (domainJsonErrorEl) domainJsonErrorEl.style.display = 'none';
    }
  }
  
  // Load existing settings first
  chrome.storage.sync.get(STORAGE_KEY, data => {
    const existingCfg = data[STORAGE_KEY] || {};
    let updatedCfg = { ...existingCfg };
    
    // Only update settings for the current active section
    switch (currentSection) {
      case 'basic':
        updatedCfg.autoSuspendMinutes = parseInt(autoSuspendEl.value, 10) || 0;
        updatedCfg.useNativeDiscard = discardEl.checked;
        updatedCfg.neverSuspendAudio = neverSuspendAudioEl.checked;
        updatedCfg.neverSuspendPinned = neverSuspendPinnedEl.checked;
        updatedCfg.neverSuspendActive = neverSuspendActiveEl.checked;
        updatedCfg.rememberLastActiveTab = rememberLastActiveTabEl.checked;
        updatedCfg.clickAnywhereToUnsuspend = clickAnywhereToUnsuspendEl.checked;
        updatedCfg.domainSuspendTimes = parsedDomainTimes;
        break;
      case 'advanced':
        updatedCfg.themeMode = normalizeThemeMode(themeModeEl.value);
        updatedCfg.suspendedIndicatorMode = normalizeIndicatorMode(suspendedIndicatorModeEl.value);
        updatedCfg.fixFaviconEnabled = fixFaviconEnabledEl.checked;
        updatedCfg.fixFaviconBatchSize = parseInt(fixFaviconBatchSizeEl.value, 10) || 0;
        updatedCfg.fixFaviconMaxRetries = parseInt(fixFaviconMaxRetriesEl.value, 10);
        updatedCfg.suspendBatchConcurrency = Math.max(1, parseInt(suspendBatchConcurrencyEl.value, 10) || 5);
        updatedCfg.domainSuspendTimes = parsedDomainTimes;
        break;
      case 'whitelist':
        updatedCfg.whitelist = whitelistEl.value.split(/\n/).map(s => s.trim()).filter(Boolean);
        updatedCfg.domainSuspendTimes = parsedDomainTimes;
        break;
      case 'migration':
        // No settings to save in migration section
        break;
      case 'about':
        // No settings to save in about section
        break;
      default:
        // If no active section found, save all (fallback to original behavior)
        updatedCfg = {
          autoSuspendMinutes: parseInt(autoSuspendEl.value, 10) || 0,
          useNativeDiscard: discardEl.checked,
          whitelist: whitelistEl.value.split(/\n/).map(s => s.trim()).filter(Boolean),
          neverSuspendAudio: neverSuspendAudioEl.checked,
          neverSuspendPinned: neverSuspendPinnedEl.checked,
          neverSuspendActive: neverSuspendActiveEl.checked,
          rememberLastActiveTab: rememberLastActiveTabEl.checked,
          clickAnywhereToUnsuspend: clickAnywhereToUnsuspendEl.checked,
          themeMode: normalizeThemeMode(themeModeEl.value),
          suspendedIndicatorMode: normalizeIndicatorMode(suspendedIndicatorModeEl.value),
          fixFaviconEnabled: fixFaviconEnabledEl.checked,
          fixFaviconBatchSize: parseInt(fixFaviconBatchSizeEl.value, 10) || 0,
          fixFaviconMaxRetries: parseInt(fixFaviconMaxRetriesEl.value, 10),
          suspendBatchConcurrency: Math.max(1, parseInt(suspendBatchConcurrencyEl.value, 10) || 5),
          domainSuspendTimes: parsedDomainTimes
        };
    }

    // Keep the suspended page cache valid even when saving non-theme sections.
    cacheThemeMode(updatedCfg.themeMode);

    chrome.storage.sync.set({ [STORAGE_KEY]: updatedCfg }, () => {
      chrome.runtime.sendMessage({ command: 'updateSettings', settings: updatedCfg });
      
      // Show save confirmation with section-specific message
      let saveMessage;
      switch (currentSection) {
        case 'basic':
          saveMessage = getMessage('savedBasicSettings');
          break;
        case 'whitelist':
          saveMessage = getMessage('savedWhitelistSettings');
          break;
        case 'migration':
          saveMessage = getMessage('savedTabMigrationSettings');
          break;
        case 'advanced':
          saveMessage = getMessage('savedAdvancedSettings');
          break;
        default:
          saveMessage = getMessage('savedNotice');
      }
      
      showNotice(saveMessage, 'success');
    });
  });
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeElements();
  initNavigation();
  setVersion();
  load();
  
  // Check initial active section and hide save button if needed
  const initialActiveSection = getCurrentActiveSection();
  const actionBar = document.querySelector('.action-bar');
  if (initialActiveSection === 'about' || initialActiveSection === 'migration' || initialActiveSection === 'changelog' || initialActiveSection === 'shortcuts' || initialActiveSection === 'session' || initialActiveSection === 'settings' || initialActiveSection === 'tabviewer') {
    actionBar.style.display = 'none';
  }
  
  // Initialize tab migration functionality
  initTabMigration();
  
  // Initialize keyboard shortcuts functionality
  initKeyboardShortcuts();
  
  // Initialize session management functionality
  initSessionManagement();
  
  // Initialize settings management functionality
  initSettingsManagement();
  
  // Add refresh whitelist button event listener
  const refreshWhitelistBtn = document.getElementById('refreshWhitelistBtn');
  if (refreshWhitelistBtn) {
    refreshWhitelistBtn.addEventListener('click', loadWhitelist);
  }
  
  // Add show suspended tabs button event listener
  const showSuspendedTabsBtn = document.getElementById('showSuspendedTabsBtn');
  if (showSuspendedTabsBtn) {
    showSuspendedTabsBtn.addEventListener('click', showSuspendedTabs);
  }

  initSuspendedTabsViewerEvents();
});

// Attach save button event listener
document.getElementById('saveBtn').addEventListener('click', save);

// Keyboard shortcut for save (Ctrl+S / Cmd+S)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});

/* ---------- Keyboard Shortcuts Functions ---------- */

// Initialize keyboard shortcuts functionality
function initKeyboardShortcuts() {
  const manageShortcutsBtn = document.getElementById('manageShortcutsBtn');
  const refreshShortcutsBtn = document.getElementById('refreshShortcutsBtn');
  
  if (manageShortcutsBtn) {
    manageShortcutsBtn.addEventListener('click', openShortcutsPage);
  }
  
  if (refreshShortcutsBtn) {
    refreshShortcutsBtn.addEventListener('click', refreshShortcuts);
  }
  
  loadKeyboardShortcuts();
}

// Load and display keyboard shortcuts
async function loadKeyboardShortcuts() {
  const container = document.getElementById('shortcutsContainer');
  if (!container) return;
  
  try {
    const commands = await chrome.commands.getAll();
    displayKeyboardShortcuts(commands, container);
  } catch (error) {
    console.error('Error loading keyboard shortcuts:', error);
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #dc3545;">
        <span data-i18n="errorLoadingShortcuts">Error loading shortcuts</span>
      </div>
    `;
  }
}

// Display keyboard shortcuts in the UI
function displayKeyboardShortcuts(commands, container) {
  if (!commands || commands.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #666;">
        <span data-i18n="noShortcutsFound">No shortcuts found</span>
      </div>
    `;
    return;
  }
  
  const filteredCommands = commands.filter(command => 
    !command.name.startsWith('_execute_')
  );
  
  if (filteredCommands.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #666;">
        <span data-i18n="noShortcutsFound">No shortcuts found</span>
      </div>
    `;
    return;
  }
  
  const commandDescriptions = COMMAND_DESCRIPTIONS;
  
  const html = filteredCommands.map(command => {
    const description = commandDescriptions[command.name];
    const displayName = description ? (getMessage(description.key) || description.default) : command.description;
    const shortcut = command.shortcut || getMessage('notAssigned') || 'Not assigned';
    const isAssigned = !!command.shortcut;
    
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; margin-bottom: 8px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px;">
        <div style="flex: 1;">
          <div style="font-weight: 500; color: #333;">${escapeHtml(displayName)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="padding: 6px 12px; background: ${isAssigned ? '#e7f3ff' : '#f0f0f0'}; color: ${isAssigned ? '#0066cc' : '#666'}; border-radius: 4px; font-size: 13px; font-weight: 500; font-family: monospace; min-width: 120px; text-align: center;">
            ${escapeHtml(shortcut)}
          </span>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

// Refresh keyboard shortcuts display
function refreshShortcuts() {
  loadKeyboardShortcuts();
  showNotice(getMessage('shortcutsRefreshed') || 'Shortcuts refreshed', 'success', 2000);
}

// Open Chrome's shortcuts management page
function openShortcutsPage() {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

/* ---------- Tab Migration Functions ---------- */

// Migration configuration for different extensions
const MIGRATION_CONFIGS = {
  marvellous: {
    name: 'The Marvellous Suspender',
    knownExtensionIds: [
      'klbibkeccnjlkjkiokjodocebajanakg',
      'noogafoofpebimajpfpamcfhoaifemoa',
      'gcknhkkoolaabfmlnjonogaaifnjlfnp',
      'ahfhijdlegdabablpippeagghigmibma',
      'jlgkpaicikihijadgifklkbpdajbkhjo',
      'ahkbmjhfoplmfkpncgoedjgkajkehcgo',
      'plpkmjcnhhnpkblimgenmdhghfgghdpp',
    ],
    urlPattern: '/suspended.html#',
    parseFunction: 'parseMarvellousTab',
    ui: {
      scanBtnId: 'scanMarvellousBtn',
      resultsId: 'migrationResults',
      statusId: 'migrationStatus',
      tabsListId: 'tabsList',
      tabsContainerId: 'tabsContainer',
      selectAllBtnId: 'selectAllBtn',
      deselectAllBtnId: 'deselectAllBtn',
      migrateBtnId: 'migrateSelectedBtn',
      progressContainerId: 'migrationProgressContainer',
      progressTextId: 'progressText',
      progressFillId: 'progressFill'
    }
  },
  tabSuspender: {
    name: 'Tab Suspender',
    knownExtensionIds: ['fiabciakcmgepblmdkmemdbbkilneeeh', 'laameccjpleogmfhilmffpdbiibgbekf'],
    urlPattern: '/park.html?|/suspended.html?',
    parseFunction: 'parseTabSuspenderTab',
    ui: {
      scanBtnId: 'scanTabSuspenderBtn',
      resultsId: 'tabSuspenderResults',
      statusId: 'tabSuspenderStatus',
      tabsListId: 'tabSuspenderTabsList',
      tabsContainerId: 'tabSuspenderTabsContainer',
      selectAllBtnId: 'selectAllTabSuspenderBtn',
      deselectAllBtnId: 'deselectAllTabSuspenderBtn',
      migrateBtnId: 'migrateTabSuspenderBtn',
      progressContainerId: 'tabSuspenderProgressContainer',
      progressTextId: 'tabSuspenderProgressText',
      progressFillId: 'tabSuspenderProgressFill'
    }
  },
  custom: {
    name: 'Custom Extension',
    knownExtensionIds: [],
    urlPattern: '',
    parseFunction: 'parseCustomTab',
    ui: {
      scanBtnId: 'scanCustomBtn',
      resultsId: 'customResults',
      statusId: 'customStatus',
      tabsListId: 'customTabsList',
      tabsContainerId: 'customTabsContainer',
      selectAllBtnId: 'selectAllCustomBtn',
      deselectAllBtnId: 'deselectAllCustomBtn',
      migrateBtnId: 'migrateCustomBtn',
      progressContainerId: 'customProgressContainer',
      progressTextId: 'customProgressText',
      progressFillId: 'customProgressFill'
    }
  }
};

let discoveredExtensionIds = new Set();

function initTabMigration() {
  initExtensionMigration('marvellous');
  initExtensionMigration('tabSuspender');
  initCustomMigration();
}

function initExtensionMigration(extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config) return;
  
  const scanBtn = document.getElementById(config.ui.scanBtnId);
  const selectAllBtn = document.getElementById(config.ui.selectAllBtnId);
  const deselectAllBtn = document.getElementById(config.ui.deselectAllBtnId);
  const migrateBtn = document.getElementById(config.ui.migrateBtnId);
  
  if (scanBtn) {
    scanBtn.addEventListener('click', () => scanForExtensionTabs(extensionKey));
  }
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => selectAllTabs(config.ui.tabsContainerId));
  }
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => deselectAllTabs(config.ui.tabsContainerId));
  }
  if (migrateBtn) {
    migrateBtn.addEventListener('click', () => migrateSelectedTabs(extensionKey));
  }
}

function initCustomMigration() {
  const testBtn = document.getElementById('testCustomPatternBtn');
  const scanBtn = document.getElementById('scanCustomBtn');
  const selectAllBtn = document.getElementById('selectAllCustomBtn');
  const deselectAllBtn = document.getElementById('deselectAllCustomBtn');
  const migrateBtn = document.getElementById('migrateCustomBtn');
  
  if (testBtn) {
    testBtn.addEventListener('click', testCustomPattern);
  }
  if (scanBtn) {
    scanBtn.addEventListener('click', scanForCustomTabs);
  }
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => selectAllTabs('customTabsContainer'));
  }
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => deselectAllTabs('customTabsContainer'));
  }
  if (migrateBtn) {
    migrateBtn.addEventListener('click', () => migrateSelectedTabs('custom'));
  }
}

function testCustomPattern() {
  const extensionId = document.getElementById('customExtensionId').value.trim();
  const path = document.getElementById('customPath').value.trim();
  const separator = document.getElementById('customSeparator').value;
  const titleParam = document.getElementById('customTitleParam').value.trim();
  const urlParam = document.getElementById('customUrlParam').value.trim();
  
  if (!extensionId || !path || !titleParam || !urlParam) {
    showNotice(getMessage('fillAllFields') || 'Please fill in all fields', 'warning');
    return;
  }
  
  const exampleUrl = `chrome-extension://${extensionId}/${path}${separator}${titleParam}=${encodeURIComponent('Example Page Title')}&${urlParam}=${encodeURIComponent('https://example.com')}`;
  
  const customConfig = createCustomConfig();
  const parsedTab = parseCustomTab(exampleUrl);
  
  if (parsedTab) {
    showNotice(getMessage('patternTestSuccess') || 'Pattern test successful! Example URL parsed correctly.', 'success');
    console.log('[ZeroRAM Suspender] Custom pattern test result:', parsedTab);
  } else {
    showNotice(getMessage('patternTestFailed') || 'Pattern test failed. Please check your configuration.', 'error');
  }
}

function createCustomConfig() {
  const extensionId = document.getElementById('customExtensionId').value.trim();
  const path = document.getElementById('customPath').value.trim();
  const separator = document.getElementById('customSeparator').value;
  const titleParam = document.getElementById('customTitleParam').value.trim();
  const urlParam = document.getElementById('customUrlParam').value.trim();
  
  return {
    extensionId,
    path,
    separator,
    titleParam,
    urlParam
  };
}

async function scanForCustomTabs() {
  const customConfig = createCustomConfig();
  
  if (!customConfig.extensionId || !customConfig.path || !customConfig.titleParam || !customConfig.urlParam) {
    showNotice(getMessage('fillAllFields') || 'Please fill in all fields', 'warning');
    return;
  }
  
  MIGRATION_CONFIGS.custom.knownExtensionIds = [customConfig.extensionId];
  MIGRATION_CONFIGS.custom.urlPattern = `/${customConfig.path}${customConfig.separator}`;
  MIGRATION_CONFIGS.custom.name = `Custom Extension (${customConfig.extensionId.substring(0, 8)}...)`;
  
  await scanForExtensionTabs('custom');
}

function isKnownExtensionTab(url, extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config || !url || !url.startsWith('chrome-extension://')) {
    return false;
  }
  
  let matchesPattern = false;
  if (extensionKey === 'tabSuspender') {
    matchesPattern = url.includes('/park.html?') || url.includes('/suspended.html?');
  } else if (extensionKey === 'custom') {
    const customConfig = createCustomConfig();
    matchesPattern = customConfig.extensionId && 
                    url.includes(customConfig.extensionId) && 
                    url.includes(`/${customConfig.path}${customConfig.separator}`);
  } else {
    matchesPattern = url.includes(config.urlPattern);
  }
  
  if (!matchesPattern) {
    return false;
  }
  
  const matches = url.match(/chrome-extension:\/\/([a-z]+)\//);
  if (!matches || matches.length < 2) {
    return false;
  }
  
  const extensionId = matches[1];
  return config.knownExtensionIds.includes(extensionId) || discoveredExtensionIds.has(extensionId);
}

function parseMarvellousTab(url) {
  try {
    if (!url || !url.startsWith('chrome-extension://') || !url.includes('/suspended.html#')) {
      return null;
    }
    
    const hashPart = url.split('#')[1];
    if (!hashPart) {
      return null;
    }
    
    const params = new URLSearchParams(hashPart);
    const title = params.get('ttl');
    const originalUrl = params.get('uri');
    const position = params.get('pos');
    
    if (!originalUrl || !params.has('ttl')) {
      return null;
    }
    
    const matches = url.match(/chrome-extension:\/\/([a-z]+)\/suspended\.html#/);
    const extensionId = matches ? matches[1] : 'unknown';
    
    let decodedTitle = originalUrl;
    if (title) {
      try {
        decodedTitle = decodeURIComponent(title);
      } catch (decodeError) {
        console.warn('[ZeroRAM Suspender] Failed to decode title, using original encoded version:', title);
        decodedTitle = title;
      }
    }

    return {
      title: decodedTitle,
      originalUrl: originalUrl,
      position: position ? parseInt(position) : 0,
      extensionId: extensionId
    };
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error parsing Marvellous Suspender tab:', error);
    return null;
  }
}

function parseTabSuspenderTab(url) {
  try {
    if (!url || !url.startsWith('chrome-extension://')) {
      return null;
    }
    
    let isVariant1 = url.includes('fiabciakcmgepblmdkmemdbbkilneeeh/park.html?');
    let isVariant2 = url.includes('laameccjpleogmfhilmffpdbiibgbekf/suspended.html?');
    
    if (!isVariant1 && !isVariant2) {
      return null;
    }
    
    const urlObj = new URL(url);
    const title = urlObj.searchParams.get('title');
    const originalUrl = urlObj.searchParams.get('url');
    
    if (!originalUrl || !title) {
      return null;
    }
    
    let extensionId = '';
    if (isVariant1) {
      extensionId = 'fiabciakcmgepblmdkmemdbbkilneeeh';
    } else if (isVariant2) {
      extensionId = 'laameccjpleogmfhilmffpdbiibgbekf';
    }
    
    let decodedTitle = title;
    let decodedUrl = originalUrl;
    
    try {
      decodedTitle = decodeURIComponent(title);
      decodedUrl = decodeURIComponent(originalUrl);
    } catch (decodeError) {
      console.warn('[ZeroRAM Suspender] Failed to decode Tab Suspender parameters:', decodeError);
    }

    return {
      title: decodedTitle,
      originalUrl: decodedUrl,
      extensionId: extensionId
    };
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error parsing Tab Suspender tab:', error);
    return null;
  }
}

function parseCustomTab(url) {
  try {
    if (!url || !url.startsWith('chrome-extension://')) {
      return null;
    }
    
    const customConfig = createCustomConfig();
    
    if (!url.includes(`/${customConfig.path}${customConfig.separator}`)) {
      return null;
    }
    
    if (!url.includes(customConfig.extensionId)) {
      return null;
    }
    
    let title, originalUrl;
    
    if (customConfig.separator === '?') {
      const urlObj = new URL(url);
      title = urlObj.searchParams.get(customConfig.titleParam);
      originalUrl = urlObj.searchParams.get(customConfig.urlParam);
    } else {
      const hashPart = url.split('#')[1];
      if (!hashPart) {
        return null;
      }
      
      const params = new URLSearchParams(hashPart);
      title = params.get(customConfig.titleParam);
      originalUrl = params.get(customConfig.urlParam);
    }
    
    if (!originalUrl || !title) {
      return null;
    }
    
    let decodedTitle = title;
    let decodedUrl = originalUrl;
    
    try {
      decodedTitle = decodeURIComponent(title);
      decodedUrl = decodeURIComponent(originalUrl);
    } catch (decodeError) {
      console.warn('[ZeroRAM Suspender] Failed to decode custom tab parameters:', decodeError);
    }

    return {
      title: decodedTitle,
      originalUrl: decodedUrl,
      extensionId: customConfig.extensionId
    };
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error parsing custom tab:', error);
    return null;
  }
}

async function scanForExtensionTabs(extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config) return;
  
  const scanBtn = document.getElementById(config.ui.scanBtnId);
  const resultsDiv = document.getElementById(config.ui.resultsId);
  const statusDiv = document.getElementById(config.ui.statusId);
  const tabsListDiv = document.getElementById(config.ui.tabsListId);
  const tabsContainer = document.getElementById(config.ui.tabsContainerId);
  
  scanBtn.disabled = true;
  scanBtn.style.opacity = '0.6';
  statusDiv.textContent = getMessage('scanningTabs');
  statusDiv.style.color = '#666';
  resultsDiv.style.display = 'block';
  tabsListDiv.style.display = 'none';
  
  try {
    const tabs = await chrome.tabs.query({});
    const foundTabs = [];
    const detectedExtensionIds = new Set();
    
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
        continue;
      }
      
      let shouldParse = false;
      if (extensionKey === 'tabSuspender') {
        shouldParse = tab.url && (tab.url.includes('/park.html?') || tab.url.includes('/suspended.html?'));
      } else if (extensionKey === 'custom') {
        const customConfig = createCustomConfig();
        shouldParse = tab.url && customConfig.extensionId && 
                     tab.url.includes(customConfig.extensionId) && 
                     tab.url.includes(`/${customConfig.path}${customConfig.separator}`);
      } else {
        shouldParse = tab.url && tab.url.includes(config.urlPattern);
      }
      
      if (shouldParse) {
        let parsedTab = null;
        if (config.parseFunction === 'parseMarvellousTab') {
          parsedTab = parseMarvellousTab(tab.url);
        } else if (config.parseFunction === 'parseTabSuspenderTab') {
          parsedTab = parseTabSuspenderTab(tab.url);
        } else if (config.parseFunction === 'parseCustomTab') {
          parsedTab = parseCustomTab(tab.url);
        }
        
        if (parsedTab) {
          const isKnownVariant = config.knownExtensionIds.includes(parsedTab.extensionId);
          
          console.log(`[ZeroRAM Suspender] Found ${config.name} tab with extension ID: ${parsedTab.extensionId}, isKnownVariant: ${isKnownVariant}`);
          
          foundTabs.push({
            ...parsedTab,
            tabId: tab.id,
            tabIndex: tab.index,
            favIconUrl: tab.favIconUrl,
            isUnknownVariant: !isKnownVariant
          });
          
          detectedExtensionIds.add(parsedTab.extensionId);
          
          if (!isKnownVariant) {
            discoveredExtensionIds.add(parsedTab.extensionId);
          }
        }
      }
    }
    
    if (detectedExtensionIds.size > 0) {
      console.log(`[ZeroRAM Suspender] Detected ${config.name} extension IDs:`, Array.from(detectedExtensionIds));
    }
    
    if (foundTabs.length === 0) {
      const noTabsFoundKey = extensionKey === 'marvellous' ? 'noMarvellousTabFound' : 'noTabSuspenderTabFound';
      statusDiv.textContent = getMessage(noTabsFoundKey) || `No ${config.name} tabs found`;
      statusDiv.style.color = '#666';
    } else {
      const knownVariants = foundTabs.filter(tab => !tab.isUnknownVariant).length;
      const unknownVariants = foundTabs.filter(tab => tab.isUnknownVariant).length;
      
      const foundTabsKey = extensionKey === 'marvellous' ? 'foundMarvellousTab' : 'foundTabSuspenderTab';
      let statusText = (getMessage(foundTabsKey) || `Found %d ${config.name} tabs`).replace('%d', foundTabs.length);
      if (unknownVariants > 0) {
        statusText += ` (${unknownVariants} ${getMessage('unknownVariant') || 'unknown variant'})`;
      }
      
      statusDiv.textContent = statusText;
      statusDiv.style.color = '#27ae60';
      
      displayExtensionTabs(foundTabs, tabsContainer);
      tabsListDiv.style.display = 'block';
    }
  } catch (error) {
    console.error(`[ZeroRAM Suspender] Error scanning ${config.name} tabs:`, error);
    statusDiv.textContent = (getMessage('errorScanningTabs') || 'Error scanning tabs: ') + error.message;
    statusDiv.style.color = '#dc3545';
  } finally {
    scanBtn.disabled = false;
    scanBtn.style.opacity = '1';
  }
}

function displayExtensionTabs(tabs, container) {
  container.innerHTML = '';
  
  tabs.forEach((tabData, index) => {
    const tabItem = document.createElement('div');
    tabItem.style.cssText = `
      display: flex;
      align-items: center;
      padding: 12px;
      margin-bottom: 8px;
      background: white;
      border-radius: 6px;
      border: 1px solid #e1e5e9;
      transition: all 0.2s ease;
    `;
    
    const variantBadge = tabData.isUnknownVariant 
      ? `<span style="background: #ffc107; color: #333; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px;">${getMessage('unknownVariant') || 'Unknown Variant'}</span>`
      : '';
    
    tabItem.innerHTML = `
      <input type="checkbox" 
             id="tab-${index}" 
             data-tab-id="${tabData.tabId}"
             data-original-url="${tabData.originalUrl}"
             data-title="${tabData.title}"
             data-favicon-url="${tabData.favIconUrl || ''}"
             checked
             style="margin-right: 12px; width: 16px; height: 16px;">
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 500; color: #333; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center;">
          ${tabData.favIconUrl ? `<img class="migration-tab-favicon-img" src="${escapeHtml(tabData.favIconUrl)}" style="width: 16px; height: 16px; margin-right: 8px; flex-shrink: 0;">` : ''}${escapeHtml(tabData.title)}${variantBadge}
        </div>
        <div style="font-size: 12px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(tabData.originalUrl)}
        </div>
        <div style="font-size: 10px; color: #999; margin-top: 2px;">
          ${getMessage('extensionId') || 'Extension ID'}: ${tabData.extensionId}
        </div>
      </div>
    `;

    const faviconImg = tabItem.querySelector('.migration-tab-favicon-img');
    if (faviconImg) {
      faviconImg.addEventListener('error', () => {
        faviconImg.style.display = 'none';
      }, { once: true });
    }
    
    container.appendChild(tabItem);
  });
}

function selectAllTabs(containerId) {
  const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]`);
  checkboxes.forEach(checkbox => {
    checkbox.checked = true;
  });
}

function deselectAllTabs(containerId) {
  const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]`);
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
}

const ProgressBarUtils = {
  updateProgress: function(options = {}) {
    const {
      completed = 0,
      total = 0,
      containerSelector = '#migrationProgressContainer',
      textSelector = '#progressText',
      fillSelector = '#progressFill',
      customText = null,
      showPercentage = false
    } = options;
    
    const progressContainer = document.querySelector(containerSelector);
    const progressText = document.querySelector(textSelector);
    const progressFill = document.querySelector(fillSelector);
    
    if (!progressContainer || !progressText || !progressFill) {
      console.warn('[ZeroRAM Suspender] Progress elements not found with selectors:', {
        containerSelector, textSelector, fillSelector
      });
      return false;
    }
    
    progressContainer.style.display = 'block';
    
    if (customText) {
      progressText.textContent = customText;
    } else if (showPercentage) {
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
      progressText.textContent = `${completed}/${total} (${percentage}%)`;
    } else {
      progressText.textContent = `${completed}/${total}`;
    }
    
    const percentage = total > 0 ? (completed / total) * 100 : 0;
    progressFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    
    return true;
  },
  
  hideProgress: function(containerSelector = '#migrationProgressContainer') {
    const progressContainer = document.querySelector(containerSelector);
    if (progressContainer) {
      progressContainer.style.display = 'none';
      return true;
    }
    return false;
  },
  
  resetProgress: function(options = {}) {
    const {
      containerSelector = '#migrationProgressContainer',
      textSelector = '#progressText',
      fillSelector = '#progressFill'
    } = options;
    
    this.updateProgress({
      completed: 0,
      total: 0,
      containerSelector,
      textSelector,
      fillSelector,
      customText: '0/0'
    });
    
    setTimeout(() => {
      this.hideProgress(containerSelector);
    }, 100);
  }
};

function updateMigrationProgress(completed, total) {
  return ProgressBarUtils.updateProgress({
    completed,
    total,
    containerSelector: '#migrationProgressContainer',
    textSelector: '#progressText',
    fillSelector: '#progressFill'
  });
}

function hideMigrationProgress() {
  return ProgressBarUtils.hideProgress('#migrationProgressContainer');
}

async function migrateSelectedTabs(extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config) return;
  
  const checkboxes = document.querySelectorAll(`#${config.ui.tabsContainerId} input[type="checkbox"]:checked`);
  const migrateBtn = document.getElementById(config.ui.migrateBtnId);
  
  if (checkboxes.length === 0) {
    showNotice(getMessage('noTabsSelected') || 'No tabs selected', 'warning');
    return;
  }
  
  const totalTabs = checkboxes.length;
  let successCount = 0;
  let failureCount = 0;
  let processedCount = 0;
  
  try {
    migrateBtn.disabled = true;
    migrateBtn.style.opacity = '0.6';
    
    ProgressBarUtils.updateProgress({
      completed: 0,
      total: totalTabs,
      containerSelector: `#${config.ui.progressContainerId}`,
      textSelector: `#${config.ui.progressTextId}`,
      fillSelector: `#${config.ui.progressFillId}`
    });
    
    for (const checkbox of checkboxes) {
      try {
        const tabId = parseInt(checkbox.dataset.tabId);
        const originalUrl = checkbox.dataset.originalUrl;
        const title = checkbox.dataset.title;
        const favIconUrl = checkbox.dataset.faviconUrl;
        
        let suspendedUrl = chrome.runtime.getURL('suspended.html') + 
          '?uri=' + encodeURIComponent(originalUrl) +
          '&ttl=' + encodeURIComponent(title);
        
        if (favIconUrl && favIconUrl !== 'chrome://favicon/') {
          suspendedUrl += '&favicon=' + encodeURIComponent(favIconUrl);
        }
        
        await chrome.tabs.update(tabId, { url: suspendedUrl });
        successCount++;
      } catch (error) {
        console.error(`[ZeroRAM Suspender] Error migrating ${config.name} tab:`, error);
        failureCount++;
      }
      
      processedCount++;
      ProgressBarUtils.updateProgress({
        completed: processedCount,
        total: totalTabs,
        containerSelector: `#${config.ui.progressContainerId}`,
        textSelector: `#${config.ui.progressTextId}`,
        fillSelector: `#${config.ui.progressFillId}`
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (successCount > 0) {
      const migrationCompleteMsg = getMessage('migrationComplete') || 'Migration completed';
      const tabsMigratedMsg = getMessage('tabsMigrated') || ' tabs migrated';
      showNotice(`${migrationCompleteMsg} (${successCount}${tabsMigratedMsg})`, 'success');
      
      setTimeout(() => {
        scanForExtensionTabs(extensionKey);
      }, 1000);
    }
    
    if (failureCount > 0) {
      const migrationFailedMsg = getMessage('migrationFailed') || 'Migration failed';
      const tabsFailedMsg = getMessage('tabsFailed') || ' tabs failed';
      showNotice(`${migrationFailedMsg} (${failureCount}${tabsFailedMsg})`, 'error');
    }
  } catch (error) {
    console.error(`[ZeroRAM Suspender] ${config.name} migration error:`, error);
    const migrationFailedMsg = getMessage('migrationFailed') || 'Migration failed';
    showNotice(`${migrationFailedMsg}: ${error.message}`, 'error');
  } finally {
    setTimeout(() => {
      ProgressBarUtils.hideProgress(`#${config.ui.progressContainerId}`);
      migrateBtn.disabled = false;
      migrateBtn.style.opacity = '1';
    }, 1000);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getMessage(key) {
  return chrome.i18n ? chrome.i18n.getMessage(key) : key;
}

function resetMigrationState() {
  resetExtensionMigrationState('marvellous');
  resetExtensionMigrationState('tabSuspender');
  resetExtensionMigrationState('custom');
  console.log('[ZeroRAM Suspender] All migration states reset');
}

function resetExtensionMigrationState(extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config) return;
  
  const resultsDiv = document.getElementById(config.ui.resultsId);
  const statusDiv = document.getElementById(config.ui.statusId);
  const tabsListDiv = document.getElementById(config.ui.tabsListId);
  const tabsContainer = document.getElementById(config.ui.tabsContainerId);
  const scanBtn = document.getElementById(config.ui.scanBtnId);
  
  if (resultsDiv) {
    resultsDiv.style.display = 'none';
  }
  
  if (statusDiv) {
    statusDiv.textContent = '';
  }
  
  if (tabsListDiv) {
    tabsListDiv.style.display = 'none';
  }
  
  if (tabsContainer) {
    tabsContainer.innerHTML = '';
  }
  
  if (scanBtn) {
    scanBtn.disabled = false;
    scanBtn.style.opacity = '1';
  }
  
  console.log(`[ZeroRAM Suspender] ${config.name} migration state reset`);
}

function clearDiscoveredIds() {
  discoveredExtensionIds.clear();
  console.log('[ZeroRAM Suspender] Cleared discovered extension IDs cache');
}

if (typeof window !== 'undefined') {
  window.ZeroRAMSuspenderDebug = {
    clearDiscoveredIds,
    resetMigrationState,
    resetExtensionMigrationState,
    getMigrationConfigs: () => MIGRATION_CONFIGS,
    getDiscoveredIds: () => Array.from(discoveredExtensionIds),
    scanForExtensionTabs,
    ProgressBarUtils
  };
}

/* ---------- End Tab Migration Functions ---------- */

/* ---------- Change Log Functions ---------- */

async function loadChangelog() {
  const changelogContent = document.getElementById('changelogContent');
  
  try {
    changelogContent.innerHTML = `
      <div class="loading-state" style="text-align: center; padding: 40px; color: #666;">
        <div style="font-size: 24px; margin-bottom: 12px;">⏳</div>
        <span data-i18n="loadingChanges">Loading change log...</span>
      </div>
    `;
    
    const response = await fetch(chrome.runtime.getURL('CHANGELOG.json'));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const commits = await response.json();
    const changelog = parseCommitsToChangelog(commits);
    
    if (changelog.length === 0) {
      changelogContent.innerHTML = `
        <div class="empty-state">
          <div class="icon">📝</div>
          <h3 data-i18n="noChangesFound">No version changes found</h3>
        </div>
      `;
      return;
    }
    
    renderChangelog(changelog, changelogContent);
    
  } catch (error) {
    console.error('Failed to load changelog:', error);
    changelogContent.innerHTML = `
      <div class="empty-state">
        <div class="icon">❌</div>
        <h3 data-i18n="failedToLoadChanges">Failed to load change log</h3>
        <p style="color: #999; font-size: 12px;">${error.message}</p>
      </div>
    `;
  }
}

function parseCommitsToChangelog(commits) {
  const changelog = [];
  let currentVersion = null;
  let currentChanges = [];
  
  const hasExplicitV100 = commits.some(commit => 
    /(?:Update version to|chore:\s*update version to)\s*1\.0\.0/i.test(commit.commit.message)
  );
  
  for (const commit of commits) {
    const message = commit.commit.message;
    const date = new Date(commit.commit.author.date);
    
    const versionMatch = message.match(/(?:Update version to|chore:\s*update version to)\s*([\d.]+)/i);
    const isInitialCommit = message === 'Initial commit';
    
    if (versionMatch) {
      if (currentVersion && currentChanges.length > 0) {
        changelog.push({
          version: currentVersion.version,
          date: currentVersion.date,
          changes: currentChanges
        });
      }
      
      currentVersion = {
        version: versionMatch[1],
        date: date
      };
      currentChanges = [];
    } else if (isInitialCommit && !hasExplicitV100) {
      if (currentVersion && currentChanges.length > 0) {
        changelog.push({
          version: currentVersion.version,
          date: currentVersion.date,
          changes: currentChanges
        });
      }
      
      currentVersion = {
        version: '1.0.0',
        date: date
      };
      currentChanges = [
        { type: 'added', description: 'Initial release', sha: commit.sha.substring(0, 7), url: commit.html_url }
      ];
    } else if (currentVersion) {
      const change = parseCommitMessage(message, commit);
      if (change) {
        currentChanges.push(change);
      }
    } else {
      if (!currentVersion) {
        currentVersion = {
          version: getMessage("unreleased") || 'Unreleased',
          date: date
        };
      }
      const change = parseCommitMessage(message, commit);
      if (change) {
        currentChanges.push(change);
      }
    }
  }
  
  if (currentVersion && currentChanges.length > 0) {
    changelog.push({
      version: currentVersion.version,
      date: currentVersion.date,
      changes: currentChanges
    });
  }
  
  return changelog;
}

function parseCommitMessage(message, commit) {
  if (message.includes('Update version to') || 
      /chore:\s*update version to/i.test(message) || 
      message.startsWith('Merge ')) {
    return null;
  }
  
  const description = message.split('\n')[0].trim();
  
  let type = 'changed';
  let finalDescription = description;
  
  const ccMatch = description.match(/^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (ccMatch) {
    const ccType = ccMatch[1].toLowerCase();
    const ccScope = ccMatch[2];
    const ccSubject = ccMatch[3].trim();
    
    const capitalizedSubject = ccSubject.charAt(0).toUpperCase() + ccSubject.slice(1);
    finalDescription = ccScope ? `[${ccScope}] ${capitalizedSubject}` : capitalizedSubject;
    
    if (ccType === 'feat') {
      type = 'added';
    } else if (ccType === 'fix') {
      type = 'fixed';
    } else if (ccType === 'perf') {
      type = 'improved';
    } else if (ccType === 'revert') {
      type = 'removed';
    } else {
      const firstWord = ccSubject.toLowerCase().split(' ')[0];
      if (firstWord === 'add' || firstWord === 'new' || firstWord === 'implement') {
        type = 'added';
      } else if (firstWord === 'fix' || firstWord === 'repair') {
        type = 'fixed';
      } else if (firstWord === 'remove' || firstWord === 'delete') {
        type = 'removed';
      } else if (firstWord === 'enhance' || firstWord === 'improve') {
        type = 'improved';
      }
    }
  } else {
    const firstLine = description.toLowerCase();
    const firstWord = firstLine.split(' ')[0];
    if (firstWord === 'add' || firstWord === 'new' || firstWord === 'implement') {
      type = 'added';
    } else if (firstWord === 'fix' || firstWord === 'repair') {
      type = 'fixed';
    } else if (firstWord === 'remove' || firstWord === 'delete') {
      type = 'removed';
    } else if (firstWord === 'enhance' || firstWord === 'improve') {
      type = 'improved';
    }
  }
  
  return {
    type: type,
    description: finalDescription,
    sha: commit.sha.substring(0, 7),
    url: commit.html_url
  };
}

function renderChangelog(changelog, container) {
  const html = changelog.map(version => {
    const changesByType = version.changes.reduce((groups, change) => {
      const type = change.type;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(change);
      return groups;
    }, {});
    
    const typeOrder = ['added', 'improved', 'fixed', 'removed', 'changed'];
    
    const changesHtml = typeOrder.map(type => {
      if (!changesByType[type] || changesByType[type].length === 0) {
        return '';
      }
      
      const typeChanges = changesByType[type].map(change => {
        const icon = getChangeIcon(change.type);
        return `
          <li class="changelog-item" style="margin-bottom: 8px; display: flex; align-items: flex-start; gap: 8px;">
            <span style="font-size: 14px; margin-top: 2px; width: 16px; text-align: center; flex-shrink: 0;">${icon}</span>
            <div style="flex: 1;">
              <span style="font-weight: 500; color: ${getChangeColor(change.type)}; text-transform: capitalize;">${change.type}:</span>
              <span style="margin-left: 4px;">${escapeHtml(change.description)}</span>
              <a href="${change.url}" target="_blank" style="margin-left: 8px; color: #667eea; text-decoration: none; font-size: 11px; opacity: 0.7;">${change.sha}</a>
            </div>
          </li>
        `;
      }).join('');
      
      return typeChanges;
    }).filter(html => html !== '').join('');
    
    return `
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-title" style="margin-bottom: 16px;">
          <span style="font-size: 18px; font-weight: 600;">${version.version}</span>
          <span style="margin-left: auto; color: #666; font-size: 12px; font-weight: normal;">
            ${version.date.toLocaleDateString()}
          </span>
        </div>
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${changesHtml}
        </ul>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

function getChangeIcon(type) {
  const icons = {
    added: '✨',
    fixed: '🐛',
    changed: '🔄',
    removed: '🗑️',
    improved: '⚡',
    security: '🔒'
  };
  return icons[type] || '📝';
}

function getChangeColor(type) {
  const colors = {
    added: '#28a745',
    fixed: '#dc3545',
    changed: '#17a2b8',
    removed: '#6c757d',
    improved: '#ffc107',
    security: '#fd7e14'
  };
  return colors[type] || '#6c757d';
}

/* ---------- End Change Log Functions ---------- */

/* ---------- Session Management Functions ---------- */

function resetSessionPreviews() {
  const exportPreview = document.getElementById('exportPreview');
  if (exportPreview) {
    exportPreview.style.display = 'none';
  }
  
  const sessionPreview = document.getElementById('sessionPreview');
  if (sessionPreview) {
    sessionPreview.style.display = 'none';
  }
  
  const sessionFileInput = document.getElementById('sessionFileInput');
  if (sessionFileInput) {
    sessionFileInput.value = '';
  }
}

function initSessionManagement() {
  const exportBtn = document.getElementById('exportBtn');
  const exportPreviewBtn = document.getElementById('exportPreviewBtn');
  const sessionFileInput = document.getElementById('sessionFileInput');
  const importSessionBtn = document.getElementById('importSessionBtn');
  const previewSessionBtn = document.getElementById('previewSessionBtn');

  if (exportBtn) {
    exportBtn.addEventListener('click', handleExport);
  }

  if (exportPreviewBtn) {
    exportPreviewBtn.addEventListener('click', previewExport);
  }

  if (sessionFileInput) {
    sessionFileInput.addEventListener('change', handleSessionFileSelected);
  }

  if (importSessionBtn) {
    importSessionBtn.addEventListener('click', importSession);
  }

  if (previewSessionBtn) {
    previewSessionBtn.addEventListener('click', previewSession);
  }
}

function parseSuspendedTab(url) {
  try {
    const suspendedPrefix = chrome.runtime.getURL('suspended.html');
    if (url.startsWith(suspendedPrefix)) {
      const urlObj = new URL(url);
      const originalUrl = urlObj.searchParams.get('uri');
      const title = urlObj.searchParams.get('ttl');
      
      if (originalUrl) {
        return {
          url: originalUrl,
          title: title || originalUrl,
          isSuspended: true
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error parsing suspended tab:', error);
    return null;
  }
}

async function getAllTabs() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    return windows.map(window => {
      return window.tabs.map(tab => {
        const suspendedInfo = parseSuspendedTab(tab.url);
        if (suspendedInfo) {
          return {
            title: suspendedInfo.title,
            url: suspendedInfo.url,
            originalTab: tab,
            wasSuspended: true
          };
        }
        
        return {
          title: tab.title,
          url: tab.url,
          originalTab: tab,
          wasSuspended: false
        };
      });
    });
  } catch (error) {
    console.error('Error getting all tabs:', error);
    throw error;
  }
}

function handleExport() {
  const formatSelect = document.getElementById('exportFormat');
  const format = formatSelect ? formatSelect.value : 'txt';
  exportSession(format);
}

async function previewExport() {
  const formatSelect = document.getElementById('exportFormat');
  const format = formatSelect ? formatSelect.value : 'txt';
  
  try {
    showNotice(getMessage('generatingPreview') || 'Generating preview...', 'info', 1000);
    
    const windowTabs = await getAllTabs();
    let content = '';

    if (format === 'txt') {
      content = windowTabs.map(windowTabs => 
        windowTabs.map(tab => tab.url).join('\n')
      ).join('\n\n');
      
    } else if (format === 'json') {
      const sessionData = windowTabs.map(windowTabs => 
        windowTabs.map(tab => ({
          title: tab.title,
          url: tab.url
        }))
      );
      
      content = JSON.stringify(sessionData, null, 2);
    }

    const previewContainer = document.getElementById('exportPreview');
    const previewContent = document.getElementById('exportPreviewContent');
    
    if (previewContent) {
      previewContent.textContent = content;
    }
    
    if (previewContainer) {
      previewContainer.style.display = 'block';
    }
    
    showNotice(getMessage('exportPreviewReady') || 'Export preview ready', 'success', 2000);
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error generating export preview:', error);
    showNotice(getMessage('previewFailed') || 'Preview failed', 'error', 3000);
  }
}

async function exportSession(format) {
  try {
    showNotice(getMessage('exportingSession') || 'Exporting session...', 'info', 2000);
    
    const windowTabs = await getAllTabs();
    let content = '';
    let filename = '';
    let mimeType = '';

    if (format === 'txt') {
      content = windowTabs.map(windowTabs => 
        windowTabs.map(tab => tab.url).join('\n')
      ).join('\n\n');
      
      filename = `session_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      mimeType = 'text/plain';
      
    } else if (format === 'json') {
      const sessionData = windowTabs.map(windowTabs => 
        windowTabs.map(tab => ({
          title: tab.title,
          url: tab.url
        }))
      );
      
      content = JSON.stringify(sessionData, null, 2);
      filename = `session_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      mimeType = 'application/json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotice(getMessage('sessionExported') || `Session exported as ${format.toUpperCase()}`, 'success', 3000);
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error exporting session:', error);
    showNotice(getMessage('exportFailed') || 'Export failed', 'error', 3000);
  }
}

function handleSessionFileSelected(event) {
  const sessionPreview = document.getElementById('sessionPreview');
  
  if (sessionPreview) {
    sessionPreview.style.display = 'none';
  }
}

function parseSessionFile(content, filename) {
  const isJson = filename.toLowerCase().endsWith('.json');
  
  if (isJson) {
    try {
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        const isValid = data.every(window => 
          Array.isArray(window) && 
          window.every(tab => 
            typeof tab === 'object' && 
            typeof tab.url === 'string' && 
            typeof tab.title === 'string'
          )
        );
        
        if (isValid) {
          return data;
        }
      }
      throw new Error('Invalid JSON structure');
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
    
  } else {
    const lines = content.split('\n');
    const windows = [];
    let currentWindow = [];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        if (currentWindow.length > 0) {
          windows.push(currentWindow);
          currentWindow = [];
        }
      } else {
        currentWindow.push({
          title: trimmedLine,
          url: trimmedLine
        });
      }
    }
    
    if (currentWindow.length > 0) {
      windows.push(currentWindow);
    }
    
    return windows;
  }
}

async function previewSession() {
  const fileInput = document.getElementById('sessionFileInput');
  const file = fileInput.files[0];
  
  if (!file) {
    showNotice(getMessage('pleaseSelectFile') || 'Please select a file first', 'warning', 3000);
    return;
  }
  
  try {
    const content = await file.text();
    const sessionData = parseSessionFile(content, file.name);
    
    const previewContainer = document.getElementById('sessionPreview');
    const previewContent = document.getElementById('sessionPreviewContent');
    
    let previewHtml = '';
    sessionData.forEach((windowTabs, windowIndex) => {
      previewHtml += `<div style="margin-bottom: 16px;">`;
      previewHtml += `<div style="font-weight: bold; color: #667eea; margin-bottom: 8px;">${getMessage('window') || 'Window'} ${windowIndex + 1} (${windowTabs.length} ${getMessage('tabs') || 'tabs'})</div>`;
      
      windowTabs.forEach((tab, tabIndex) => {
        previewHtml += `<div style="margin-left: 16px; margin-bottom: 4px;">`;
        previewHtml += `<span style="color: #666; font-size: 11px;">${tabIndex + 1}.</span> `;
        previewHtml += `<span style="font-weight: 500;">${escapeHtml(tab.title)}</span><br/>`;
        previewHtml += `<span style="margin-left: 16px; color: #888; font-size: 11px;">${escapeHtml(tab.url)}</span>`;
        previewHtml += `</div>`;
      });
      
      previewHtml += `</div>`;
    });
    
    previewContent.innerHTML = previewHtml;
    previewContainer.style.display = 'block';
    
    showNotice(getMessage('sessionPreviewed') || 'Session preview ready', 'success', 2000);
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error previewing session:', error);
    showNotice(getMessage('previewFailed') || 'Preview failed: Invalid file format', 'error', 3000);
  }
}

async function importSession() {
  const fileInput = document.getElementById('sessionFileInput');
  const importAsSuspended = document.getElementById('importAsSuspended').checked;
  const file = fileInput.files[0];
  
  if (!file) {
    showNotice(getMessage('pleaseSelectFile') || 'Please select a file first', 'warning', 3000);
    return;
  }
  
  try {
    const content = await file.text();
    const sessionData = parseSessionFile(content, file.name);
    
    showImportProgress(true);
    let totalTabs = 0;
    let completedTabs = 0;
    
    sessionData.forEach(windowTabs => {
      totalTabs += windowTabs.length;
    });
    
    updateImportProgress(completedTabs, totalTabs);
    
    for (const windowTabs of sessionData) {
      if (windowTabs.length === 0) continue;
      
      const firstTab = windowTabs[0];
      let tabUrl = firstTab.url;
      
      if (importAsSuspended) {
        tabUrl = chrome.runtime.getURL('suspended.html') + 
          `?uri=${encodeURIComponent(firstTab.url)}&ttl=${encodeURIComponent(firstTab.title)}`;
      }
      
      const newWindow = await chrome.windows.create({
        url: tabUrl,
        focused: false
      });
      
      completedTabs++;
      updateImportProgress(completedTabs, totalTabs);
      
      for (let i = 1; i < windowTabs.length; i++) {
        const tab = windowTabs[i];
        let tabUrl = tab.url;
        
        if (importAsSuspended) {
          tabUrl = chrome.runtime.getURL('suspended.html') + 
            `?uri=${encodeURIComponent(tab.url)}&ttl=${encodeURIComponent(tab.title)}`;
        }
        
        await chrome.tabs.create({
          windowId: newWindow.id,
          url: tabUrl,
          active: false
        });
        
        completedTabs++;
        updateImportProgress(completedTabs, totalTabs);
        
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    
    showImportProgress(false);
    showNotice(getMessage('sessionImported') || `Session imported successfully (${totalTabs} tabs)`, 'success', 4000);
    
    fileInput.value = '';
    document.getElementById('sessionPreview').style.display = 'none';
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error importing session:', error);
    showImportProgress(false);
    showNotice(getMessage('importFailed') || 'Import failed: ' + error.message, 'error', 4000);
  }
}

function showImportProgress(show) {
  const container = document.getElementById('importProgressContainer');
  if (container) {
    container.style.display = show ? 'block' : 'none';
  }
}

function updateImportProgress(completed, total) {
  const progressText = document.getElementById('importProgressText');
  const progressFill = document.getElementById('importProgressFill');
  
  if (progressText) {
    progressText.textContent = `${completed}/${total}`;
  }
  
  if (progressFill) {
    const percentage = total > 0 ? (completed / total) * 100 : 0;
    progressFill.style.width = `${percentage}%`;
  }
}

/* ---------- End Session Management Functions ---------- */

/* ---------- Settings Management Functions ---------- */

function initSettingsManagement() {
  const exportSettingsBtn = document.getElementById('exportSettingsBtn');
  const previewSettingsBtn = document.getElementById('previewSettingsBtn');
  const settingsFileInput = document.getElementById('settingsFileInput');
  const previewImportSettingsBtn = document.getElementById('previewImportSettingsBtn');
  const importSettingsBtn = document.getElementById('importSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');

  if (exportSettingsBtn) {
    exportSettingsBtn.addEventListener('click', exportSettings);
  }

  if (previewSettingsBtn) {
    previewSettingsBtn.addEventListener('click', previewSettings);
  }

  if (settingsFileInput) {
    settingsFileInput.addEventListener('change', handleSettingsFileSelected);
  }

  if (previewImportSettingsBtn) {
    previewImportSettingsBtn.addEventListener('click', previewImportSettings);
  }

  if (importSettingsBtn) {
    importSettingsBtn.addEventListener('click', importSettings);
  }

  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener('click', confirmResetSettings);
  }
}

function getDefaultSettings() {
  return {
    autoSuspendMinutes: 30,
    useNativeDiscard: true,
    neverSuspendAudio: true,
    neverSuspendPinned: true,
    neverSuspendActive: false,
    rememberLastActiveTab: true,
    clickAnywhereToUnsuspend: false,
    whitelist: [],
    themeMode: 'auto',
    suspendedIndicatorMode: 'favicon',
    fixFaviconEnabled: true,
    fixFaviconBatchSize: FAVICON_FIX_DEFAULT_BATCH_SIZE,
    fixFaviconMaxRetries: 5,
    suspendBatchConcurrency: 5,
    domainSuspendTimes: {}
  };
}

async function getCurrentSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, data => {
      const cfg = data[STORAGE_KEY] || {};
      const settings = {
        autoSuspendMinutes: cfg.autoSuspendMinutes != null ? cfg.autoSuspendMinutes : 30,
        useNativeDiscard: cfg.useNativeDiscard !== false,
        neverSuspendAudio: cfg.neverSuspendAudio !== false,
        neverSuspendPinned: cfg.neverSuspendPinned !== false,
        neverSuspendActive: cfg.neverSuspendActive === true,
        rememberLastActiveTab: cfg.rememberLastActiveTab !== false,
        clickAnywhereToUnsuspend: cfg.clickAnywhereToUnsuspend === true,
        whitelist: cfg.whitelist || [],
        themeMode: normalizeThemeMode(cfg.themeMode),
        suspendedIndicatorMode: normalizeIndicatorMode(cfg.suspendedIndicatorMode),
        fixFaviconEnabled: cfg.fixFaviconEnabled !== false,
        fixFaviconBatchSize: typeof cfg.fixFaviconBatchSize === 'number' ? cfg.fixFaviconBatchSize : FAVICON_FIX_DEFAULT_BATCH_SIZE,
        fixFaviconMaxRetries: typeof cfg.fixFaviconMaxRetries === 'number' ? cfg.fixFaviconMaxRetries : 5,
        suspendBatchConcurrency: typeof cfg.suspendBatchConcurrency === 'number' ? cfg.suspendBatchConcurrency : 5,
        domainSuspendTimes: cfg.domainSuspendTimes || {}
      };
      resolve(settings);
    });
  });
}

async function exportSettings() {
  try {
    showNotice(getMessage('exportingSettings') || 'Exporting settings...', 'info', 2000);
    
    const settings = await getCurrentSettings();
    let shortcuts = [];
    try {
      const commands = await chrome.commands.getAll();
      shortcuts = (commands || [])
        .filter(c => !c.name.startsWith('_execute_'))
        .filter(c => c.shortcut && c.shortcut.trim())
        .map(c => ({ name: c.name, shortcut: c.shortcut }));
    } catch (_) {}
    const exportData = {
      ...settings,
      shortcuts,
      exportedAt: new Date().toISOString(),
      exportedBy: chrome.runtime.getManifest().name,
      version: chrome.runtime.getManifest().version
    };
    
    const content = JSON.stringify(exportData, null, 2);
    const filename = `ZeroRAMSuspender-settings_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotice(getMessage('settingsExported') || 'Settings exported successfully', 'success', 3000);
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error exporting settings:', error);
    showNotice(getMessage('exportFailed') || 'Export failed', 'error', 3000);
  }
}

async function previewSettings() {
  try {
    showNotice(getMessage('generatingPreview') || 'Generating preview...', 'info', 1000);
    
    const settings = await getCurrentSettings();
    let shortcuts = [];
    try {
      const commands = await chrome.commands.getAll();
      shortcuts = (commands || [])
        .filter(c => !c.name.startsWith('_execute_'))
        .filter(c => c.shortcut && c.shortcut.trim())
        .map(c => ({ name: c.name, shortcut: c.shortcut }));
    } catch (_) {}
    const exportData = {
      ...settings,
      shortcuts,
      exportedAt: new Date().toISOString(),
      exportedBy: chrome.runtime.getManifest().name,
      version: chrome.runtime.getManifest().version
    };
    
    const content = JSON.stringify(exportData, null, 2);
    
    const previewContainer = document.getElementById('settingsPreview');
    const previewContent = document.getElementById('settingsPreviewContent');
    
    if (previewContent) {
      previewContent.textContent = content;
    }
    
    if (previewContainer) {
      previewContainer.style.display = 'block';
    }
    
    showNotice(getMessage('settingsPreviewReady') || 'Settings preview ready', 'success', 2000);
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error generating settings preview:', error);
    showNotice(getMessage('previewFailed') || 'Preview failed', 'error', 3000);
  }
}

function handleSettingsFileSelected(event) {
  const file = event.target.files[0];
  const importSettingsPreview = document.getElementById('importSettingsPreview');
  
  if (importSettingsPreview) {
    importSettingsPreview.style.display = 'none';
  }
}

async function previewImportSettings() {
  const fileInput = document.getElementById('settingsFileInput');
  const file = fileInput.files[0];
  
  if (!file) {
    showNotice(getMessage('pleaseSelectFile') || 'Please select a file first', 'warning', 3000);
    return;
  }
  
  try {
    const content = await file.text();
    const settingsData = JSON.parse(content);
    
    if (!validateSettingsData(settingsData)) {
      throw new Error('Invalid settings file format');
    }
    
    const previewContainer = document.getElementById('importSettingsPreview');
    const previewContent = document.getElementById('importSettingsPreviewContent');
    
    let previewText = `${getMessage('settingsFileInfo') || 'Settings File Information'}:\n`;
    
    let exportedAtText = 'Unknown';
    if (settingsData.exportedAt) {
      try {
        const date = new Date(settingsData.exportedAt);
        exportedAtText = date.toLocaleString();
      } catch (error) {
        exportedAtText = settingsData.exportedAt;
      }
    }
    
    previewText += `${getMessage('exportedAt') || 'Exported at'}: ${exportedAtText}\n`;
    previewText += `${getMessage('version') || 'Version'}: ${settingsData.version || 'Unknown'}\n\n`;
    previewText += `${getMessage('settingsToImport') || 'Settings to import'}:\n`;
    previewText += `• ${getMessage('autoSuspendLabel') || 'Auto suspend'}: ${settingsData.autoSuspendMinutes || 0} ${getMessage('minutes') || 'minutes'}\n`;
    previewText += `• ${getMessage('nativeDiscardLabel') || 'Native discard'}: ${settingsData.useNativeDiscard ? getMessage('enabled') || 'Enabled' : getMessage('disabled') || 'Disabled'}\n`;
    previewText += `• ${getMessage('neverSuspendAudio') || 'Never suspend audio tabs'}: ${settingsData.neverSuspendAudio ? getMessage('enabled') || 'Enabled' : getMessage('disabled') || 'Disabled'}\n`;
    previewText += `• ${getMessage('neverSuspendPinned') || 'Never suspend pinned tabs'}: ${settingsData.neverSuspendPinned ? getMessage('enabled') || 'Enabled' : getMessage('disabled') || 'Disabled'}\n`;
    previewText += `• ${getMessage('neverSuspendActive') || 'Never suspend active tab'}: ${settingsData.neverSuspendActive ? getMessage('enabled') || 'Enabled' : getMessage('disabled') || 'Disabled'}\n`;
    previewText += `• ${getMessage('rememberLastActiveTab') || 'Remember last active tab when browser loses focus'}: ${settingsData.rememberLastActiveTab !== false ? getMessage('enabled') || 'Enabled' : getMessage('disabled') || 'Disabled'}\n`;
    previewText += `• ${getMessage('themeSettings') || 'Theme'}: ${settingsData.themeMode || 'auto'}\n`;
    previewText += `• ${getMessage('whitelistTitle') || 'Whitelist'}: ${(settingsData.whitelist || []).length} ${getMessage('items') || 'items'}\n`;
    previewText += `• ${getMessage('clickAnywhereToUnsuspend') || 'Click anywhere on the suspended page to unsuspend'}: ${settingsData.clickAnywhereToUnsuspend === true ? getMessage('enabled') || 'Enabled' : getMessage('disabled') || 'Disabled'}\n`;
    
    if (settingsData.domainSuspendTimes && Object.keys(settingsData.domainSuspendTimes).length > 0) {
      previewText += `\n${getMessage('domainSuspendTimes') || 'Domain-specific suspend times'}:\n`;
      Object.entries(settingsData.domainSuspendTimes).forEach(([domain, minutes]) => {
        previewText += `  • ${domain}: ${minutes} ${getMessage('minutes') || 'minutes'}\n`;
      });
    }
    
    if (Array.isArray(settingsData.shortcuts) && settingsData.shortcuts.length > 0) {
      previewText += '\n' + (getMessage('keyboardShortcuts') || 'Keyboard Shortcuts') + ':\n';
      settingsData.shortcuts.forEach((sc, index) => {
        const key = sc.shortcut && sc.shortcut.trim() ? sc.shortcut : (getMessage('notAssigned') || 'Not assigned');
        const desc = COMMAND_DESCRIPTIONS[sc.name];
        const displayName = desc ? (getMessage(desc.key) || desc.default) : sc.name;
        previewText += `  ${index + 1}. ${displayName} -> ${key}\n`;
      });
    }
    
    if (settingsData.whitelist && settingsData.whitelist.length > 0) {
      previewText += '\n' + (getMessage('whitelistItems') || 'Whitelist items') + ':\n';
      settingsData.whitelist.forEach((item, index) => {
        previewText += `  ${index + 1}. ${item}\n`;
      });
    }
    
    if (previewContent) {
      previewContent.textContent = previewText;
    }
    
    if (previewContainer) {
      previewContainer.style.display = 'block';
    }
    
    showNotice(getMessage('importPreviewReady') || 'Import preview ready', 'success', 2000);
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error previewing import settings:', error);
    showNotice(getMessage('previewFailed') || 'Preview failed: Invalid file format', 'error', 3000);
  }
}

function validateSettingsData(data) {
  if (!data || typeof data !== 'object') return false;
  
  const requiredFields = ['autoSuspendMinutes', 'useNativeDiscard', 'neverSuspendAudio', 'neverSuspendPinned', 'neverSuspendActive', 'whitelist'];
  
  return requiredFields.every(field => field in data);
}

async function importSettings() {
  const fileInput = document.getElementById('settingsFileInput');
  const file = fileInput.files[0];
  
  if (!file) {
    showNotice(getMessage('pleaseSelectFile') || 'Please select a file first', 'warning', 3000);
    return;
  }
  
  try {
    const content = await file.text();
    const settingsData = JSON.parse(content);
    
    if (!validateSettingsData(settingsData)) {
      throw new Error('Invalid settings file format');
    }
    
    const newSettings = {
      autoSuspendMinutes: settingsData.autoSuspendMinutes != null ? settingsData.autoSuspendMinutes : 30,
      useNativeDiscard: settingsData.useNativeDiscard !== false,
      neverSuspendAudio: settingsData.neverSuspendAudio !== false,
      neverSuspendPinned: settingsData.neverSuspendPinned !== false,
      neverSuspendActive: settingsData.neverSuspendActive === true,
      rememberLastActiveTab: settingsData.rememberLastActiveTab !== false,
      clickAnywhereToUnsuspend: settingsData.clickAnywhereToUnsuspend === true,
      whitelist: Array.isArray(settingsData.whitelist) ? settingsData.whitelist : [],
      themeMode: normalizeThemeMode(settingsData.themeMode),
      suspendedIndicatorMode: normalizeIndicatorMode(settingsData.suspendedIndicatorMode),
      fixFaviconEnabled: settingsData.fixFaviconEnabled !== false,
      fixFaviconBatchSize: typeof settingsData.fixFaviconBatchSize === 'number' ? settingsData.fixFaviconBatchSize : FAVICON_FIX_DEFAULT_BATCH_SIZE,
      fixFaviconMaxRetries: typeof settingsData.fixFaviconMaxRetries === 'number' ? settingsData.fixFaviconMaxRetries : 5,
      suspendBatchConcurrency: typeof settingsData.suspendBatchConcurrency === 'number' ? settingsData.suspendBatchConcurrency : 5,
      domainSuspendTimes: settingsData.domainSuspendTimes || {}
    };
    
    cacheThemeMode(newSettings.themeMode);

    await new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: newSettings }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    
    load();
    
    showNotice(getMessage('settingsImported') || 'Settings imported successfully', 'success', 4000);
    
    fileInput.value = '';
    document.getElementById('importSettingsPreview').style.display = 'none';
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error importing settings:', error);
    showNotice(getMessage('importFailed') || 'Import failed: ' + error.message, 'error', 4000);
  }
}

function confirmResetSettings() {
  const confirmMsg = getMessage('confirmResetSettings') || 'Are you sure you want to reset all settings to their default values? This action cannot be undone.';
  
  if (confirm(confirmMsg)) {
    resetSettings();
  }
}

async function resetSettings() {
  try {
    const defaultSettings = getDefaultSettings();
    
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: defaultSettings }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    
    load();
    
    showNotice(getMessage('settingsReset') || 'Settings have been reset to defaults', 'success', 4000);
    
    const settingsPreview = document.getElementById('settingsPreview');
    const importSettingsPreview = document.getElementById('importSettingsPreview');
    
    if (settingsPreview) {
      settingsPreview.style.display = 'none';
    }
    if (importSettingsPreview) {
      importSettingsPreview.style.display = 'none';
    }
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error resetting settings:', error);
    showNotice(getMessage('resetFailed') || 'Reset failed', 'error', 3000);
  }
}

function resetSettingsPreviews() {
  const settingsFileInput = document.getElementById('settingsFileInput');
  if (settingsFileInput) {
    settingsFileInput.value = '';
  }
  
  const settingsPreview = document.getElementById('settingsPreview');
  if (settingsPreview) {
    settingsPreview.style.display = 'none';
  }
  
  const importSettingsPreview = document.getElementById('importSettingsPreview');
  if (importSettingsPreview) {
    importSettingsPreview.style.display = 'none';
  }
  
  const settingsPreviewContent = document.getElementById('settingsPreviewContent');
  if (settingsPreviewContent) {
    settingsPreviewContent.textContent = '';
  }
  
  const importSettingsPreviewContent = document.getElementById('importSettingsPreviewContent');
  if (importSettingsPreviewContent) {
    importSettingsPreviewContent.textContent = '';
  }
}

/* ---------- End Settings Management Functions ---------- */

/* ---------- Suspended Tabs Information Functions ---------- */

function getSelectedTabViewerFilter() {
  const filterEl = document.getElementById('suspendedTabsFilter');
  const value = filterEl ? filterEl.value : TAB_VIEWER_FILTER_SUSPENDED_ALL;

  if (value === TAB_VIEWER_FILTER_SUSPENDED_UNDISCARDED || value === TAB_VIEWER_FILTER_NOT_SUSPENDED) {
    return value;
  }

  return TAB_VIEWER_FILTER_SUSPENDED_ALL;
}

function isTabViewerInfoVisible() {
  const suspendedTabsInfo = document.getElementById('suspendedTabsInfo');
  return Boolean(suspendedTabsInfo && suspendedTabsInfo.style.display !== 'none');
}

function handleSuspendedTabsFilterChange() {
  if (!isTabViewerInfoVisible()) {
    return;
  }

  showSuspendedTabs();
}

function initSuspendedTabsViewerEvents() {
  if (suspendedTabsViewerState.eventsBound) {
    return;
  }

  const suspendedTabsList = document.getElementById('suspendedTabsList');
  if (!suspendedTabsList) {
    return;
  }

  suspendedTabsList.addEventListener('click', handleSuspendedTabsListClick);
  suspendedTabsList.addEventListener('error', handleSuspendedTabFaviconError, true);

  const filterEl = document.getElementById('suspendedTabsFilter');
  if (filterEl) {
    filterEl.addEventListener('change', handleSuspendedTabsFilterChange);
  }

  suspendedTabsViewerState.eventsBound = true;
}

function setSuspendedTabsButtonState(button, isLoading) {
  if (!button) {
    return;
  }

  button.disabled = isLoading;
  button.style.opacity = isLoading ? '0.6' : '1';

  const icon = document.createElement('span');
  icon.textContent = isLoading ? '\u23F3' : '\uD83D\uDCCA';

  const label = document.createElement('span');
  label.textContent = isLoading
    ? (getMessage('loading') || 'Loading...')
    : (getMessage('showSuspendedTabs') || 'Show Suspended Tabs');

  button.replaceChildren(icon, label);
}

function shouldIncludeTabInView(isSuspended, isDiscarded, filterMode) {
  if (filterMode === TAB_VIEWER_FILTER_SUSPENDED_UNDISCARDED) {
    return isSuspended && !isDiscarded;
  }

  if (filterMode === TAB_VIEWER_FILTER_NOT_SUSPENDED) {
    return !isSuspended;
  }

  return isSuspended;
}

function buildSuspendedTabsViewModel(allTabs, suspendedPrefix, filterMode) {
  const tabsByWindow = new Map();
  let suspendedCount = 0;
  let discardedCount = 0;
  let unsuspendedCount = 0;
  let matchedCount = 0;

  for (const tab of allTabs) {
    const isSuspended = Boolean(tab.url && tab.url.startsWith(suspendedPrefix));
    const isDiscarded = Boolean(tab.discarded);

    if (isSuspended) {
      suspendedCount += 1;
      if (isDiscarded) {
        discardedCount += 1;
      }
    } else {
      unsuspendedCount += 1;
    }

    if (!shouldIncludeTabInView(isSuspended, isDiscarded, filterMode)) {
      continue;
    }

    matchedCount += 1;

    let displayUrl = tab.url || '';
    let displayTitle = tab.title || displayUrl;

    if (isSuspended) {
      const parsed = parseSuspendedTab(tab.url || '');
      if (parsed && parsed.url) {
        displayUrl = parsed.url;
        displayTitle = parsed.title || parsed.url;
      }
    }

    if (!tabsByWindow.has(tab.windowId)) {
      tabsByWindow.set(tab.windowId, []);
    }

    tabsByWindow.get(tab.windowId).push({
      id: tab.id,
      windowId: tab.windowId,
      isSuspended: isSuspended,
      discarded: isDiscarded,
      favIconUrl: tab.favIconUrl || '',
      displayTitle: displayTitle,
      displayUrl: displayUrl
    });
  }

  const windows = Array.from(tabsByWindow.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([windowId, tabs]) => ({
      windowId: Number(windowId),
      tabs: tabs
    }));

  return {
    filterMode: filterMode,
    totalTabs: allTabs.length,
    suspendedCount: suspendedCount,
    discardedCount: discardedCount,
    undiscardedSuspendedCount: Math.max(0, suspendedCount - discardedCount),
    unsuspendedCount: unsuspendedCount,
    matchedCount: matchedCount,
    windows: windows
  };
}

function getSuspendedTabsMessages() {
  return {
    window: getMessage('window') || 'Window',
    tab: getMessage('tab') || 'tab',
    tabs: getMessage('tabs') || 'tabs',
    suspended: getMessage('suspended') || 'Suspended',
    discarded: getMessage('discarded') || 'Discarded',
    notSuspended: getMessage('notSuspended') || 'Not suspended',
    tabId: getMessage('tabId') || 'Tab ID',
    windowId: getMessage('windowId') || 'Window ID',
    unsuspend: getMessage('unsuspend') || 'Unsuspend'
  };
}

function buildSuspendedTabsCountText(stats) {
  const totalTabsText = (getMessage('totalTabsCount') || 'Total tabs: %d')
    .replace('%d', stats.totalTabs);

  if (stats.filterMode === TAB_VIEWER_FILTER_SUSPENDED_UNDISCARDED) {
    if (stats.matchedCount === 0) {
      return `${getMessage('noTabsMatchFilter') || 'No tabs match the current filter'} | ${totalTabsText}`;
    }

    const text = (getMessage('suspendedUndiscardedTabsFound') || 'Found %d suspended but not discarded tabs')
      .replace('%d', stats.matchedCount);
    return `${text} | ${totalTabsText}`;
  }

  if (stats.filterMode === TAB_VIEWER_FILTER_NOT_SUSPENDED) {
    if (stats.matchedCount === 0) {
      return `${getMessage('noTabsMatchFilter') || 'No tabs match the current filter'} | ${totalTabsText}`;
    }

    const text = (getMessage('notSuspendedTabsFound') || 'Found %d not suspended tabs')
      .replace('%d', stats.matchedCount);
    return `${text} | ${totalTabsText}`;
  }

  if (stats.matchedCount === 0) {
    return `${getMessage('noSuspendedTabs') || 'No suspended tabs found'} | ${totalTabsText}`;
  }

  const baseText = (getMessage('suspendedTabsFound') || 'Found %d suspended tabs')
    .replace('%d', stats.matchedCount);

  if (stats.discardedCount > 0) {
    const discardedText = (getMessage('discardedTabsCount') || '(%d discarded)')
      .replace('%d', stats.discardedCount);
    return `${baseText} ${discardedText} | ${totalTabsText}`;
  }

  return `${baseText} | ${totalTabsText}`;
}

function updateSuspendedTabsCountDisplay() {
  const suspendedTabsCount = document.getElementById('suspendedTabsCount');
  if (!suspendedTabsCount) {
    return;
  }

  suspendedTabsCount.textContent = buildSuspendedTabsCountText(suspendedTabsViewerState.stats);
  suspendedTabsCount.style.color = suspendedTabsViewerState.stats.matchedCount > 0 ? '#27ae60' : '#666';
}

function createSuspendedWindowSection(windowData, messages) {
  const section = document.createElement('div');
  section.className = 'suspended-window-section';
  section.dataset.windowId = String(windowData.windowId);

  const header = document.createElement('div');
  header.className = 'suspended-window-header';

  const windowPrefix = document.createElement('span');
  windowPrefix.textContent = `${messages.window} ${windowData.windowId} (`;

  const count = document.createElement('span');
  count.className = 'window-tab-count';
  count.textContent = String(windowData.tabs.length);

  const unit = document.createElement('span');
  unit.className = 'window-tab-label';
  unit.style.marginLeft = '4px';
  unit.textContent = windowData.tabs.length === 1 ? messages.tab : messages.tabs;

  const suffix = document.createElement('span');
  suffix.textContent = ')';

  header.append(windowPrefix, count, unit, suffix);

  const body = document.createElement('div');
  body.className = 'suspended-window-body';

  section.append(header, body);

  return {
    section: section,
    body: body
  };
}

function createSuspendedTabItem(tab, tabIndex, messages) {
  const tabItem = document.createElement('div');
  tabItem.className = 'suspended-tab-item';
  tabItem.dataset.tabId = String(tab.id);
  tabItem.dataset.windowId = String(tab.windowId);
  tabItem.dataset.discarded = tab.discarded ? '1' : '0';
  tabItem.dataset.isSuspended = tab.isSuspended ? '1' : '0';

  const escapedTitle = escapeHtml(tab.displayTitle);
  const escapedUrl = escapeHtml(tab.displayUrl);
  const escapedFavicon = tab.favIconUrl ? escapeHtml(tab.favIconUrl) : '';

  let statusBadges;
  if (tab.isSuspended) {
    const discardedBadge = tab.discarded
      ? `<span class="suspended-tab-badge suspended-tab-badge-discarded">${escapeHtml(messages.discarded)}</span>`
      : '';

    statusBadges = `
      <span class="suspended-tab-badge suspended-tab-badge-suspended">${escapeHtml(messages.suspended)}</span>
      ${discardedBadge}
    `;
  } else {
    const discardedBadge = tab.discarded
      ? `<span class="suspended-tab-badge suspended-tab-badge-discarded">${escapeHtml(messages.discarded)}</span>`
      : '';

    statusBadges = `
      <span class="suspended-tab-badge suspended-tab-badge-not-suspended">${escapeHtml(messages.notSuspended)}</span>
      ${discardedBadge}
    `;
  }

  const actionsHtml = tab.isSuspended
    ? `
      <div class="suspended-tab-actions">
        <button class="unsuspend-tab-btn" data-tab-id="${tab.id}" data-original-url="${escapedUrl}">
          ${escapeHtml(messages.unsuspend)}
        </button>
      </div>
    `
    : '';

  tabItem.innerHTML = `
    <div class="suspended-tab-index">${tabIndex}.</div>
    <div class="suspended-tab-main">
      <div class="suspended-tab-title-line">
        ${escapedFavicon ? `<img class="suspended-tab-favicon-img" src="${escapedFavicon}" loading="lazy">` : ''}
        <span class="suspended-tab-title" title="${escapedTitle}">${escapedTitle}</span>
        <div class="suspended-tab-badges">
          ${statusBadges}
        </div>
      </div>
      <div class="suspended-tab-url" title="${escapedUrl}">${escapedUrl}</div>
      <div class="suspended-tab-meta">
        ${escapeHtml(messages.tabId)}: ${tab.id} | ${escapeHtml(messages.windowId)}: ${tab.windowId}
      </div>
    </div>
    ${actionsHtml}
  `;

  return tabItem;
}

function nextRenderFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(() => resolve());
  });
}

function renderNoSuspendedTabsState(container, filterMode) {
  const isDefaultFilter = filterMode === TAB_VIEWER_FILTER_SUSPENDED_ALL;
  const emptyDesc = isDefaultFilter
    ? (getMessage('noSuspendedTabsDesc') || 'No suspended tabs found. Suspended tabs are created when ZeroRAM Suspender puts tabs to sleep to save memory.')
    : (getMessage('noTabsMatchFilter') || 'No tabs match the current filter');

  container.innerHTML = `
    <div class="suspended-tabs-empty-state">
      <span class="suspended-tabs-empty-icon">\uD83D\uDCA4</span>
      <div class="suspended-tabs-empty-desc">${escapeHtml(emptyDesc)}</div>
    </div>
  `;
}

async function displaySuspendedTabsList(viewModel, container, renderToken) {
  container.innerHTML = '';

  if (viewModel.matchedCount === 0) {
    renderNoSuspendedTabsState(container, viewModel.filterMode);
    return;
  }

  const messages = getSuspendedTabsMessages();

  for (const windowData of viewModel.windows) {
    if (renderToken !== suspendedTabsViewerState.renderToken) {
      return;
    }

    const windowSection = createSuspendedWindowSection(windowData, messages);
    container.appendChild(windowSection.section);

    for (let i = 0; i < windowData.tabs.length; i += SUSPENDED_TABS_RENDER_BATCH_SIZE) {
      if (renderToken !== suspendedTabsViewerState.renderToken) {
        return;
      }

      const end = Math.min(i + SUSPENDED_TABS_RENDER_BATCH_SIZE, windowData.tabs.length);
      const fragment = document.createDocumentFragment();

      for (let j = i; j < end; j++) {
        fragment.appendChild(createSuspendedTabItem(windowData.tabs[j], j + 1, messages));
      }

      windowSection.body.appendChild(fragment);

      if (end < windowData.tabs.length) {
        await nextRenderFrame();
      }
    }

    await nextRenderFrame();
  }
}

function updateWindowHeaderCount(windowSection) {
  const countElement = windowSection.querySelector('.window-tab-count');
  const unitElement = windowSection.querySelector('.window-tab-label');
  const rows = windowSection.querySelectorAll('.suspended-tab-item');

  if (countElement) {
    countElement.textContent = String(rows.length);
  }

  if (unitElement) {
    unitElement.textContent = rows.length === 1
      ? (getMessage('tab') || 'tab')
      : (getMessage('tabs') || 'tabs');
  }

  rows.forEach((row, index) => {
    const tabIndex = row.querySelector('.suspended-tab-index');
    if (tabIndex) {
      tabIndex.textContent = `${index + 1}.`;
    }
  });
}

function removeSuspendedTabRow(tabId) {
  const suspendedTabsList = document.getElementById('suspendedTabsList');
  if (!suspendedTabsList) {
    return false;
  }

  const tabRow = suspendedTabsList.querySelector(`.suspended-tab-item[data-tab-id="${tabId}"]`);
  if (!tabRow) {
    return false;
  }

  if (tabRow.dataset.isSuspended !== '1') {
    return false;
  }

  const windowSection = tabRow.closest('.suspended-window-section');
  const wasDiscarded = tabRow.dataset.discarded === '1';
  tabRow.remove();

  suspendedTabsViewerState.stats.suspendedCount = Math.max(0, suspendedTabsViewerState.stats.suspendedCount - 1);
  suspendedTabsViewerState.stats.unsuspendedCount += 1;
  if (wasDiscarded) {
    suspendedTabsViewerState.stats.discardedCount = Math.max(0, suspendedTabsViewerState.stats.discardedCount - 1);
  } else {
    suspendedTabsViewerState.stats.undiscardedSuspendedCount = Math.max(0, suspendedTabsViewerState.stats.undiscardedSuspendedCount - 1);
  }
  suspendedTabsViewerState.stats.matchedCount = Math.max(0, suspendedTabsViewerState.stats.matchedCount - 1);

  updateSuspendedTabsCountDisplay();

  if (windowSection) {
    const remainingRows = windowSection.querySelectorAll('.suspended-tab-item').length;
    if (remainingRows === 0) {
      windowSection.remove();
    } else {
      updateWindowHeaderCount(windowSection);
    }
  }

  if (suspendedTabsViewerState.stats.matchedCount === 0) {
    renderNoSuspendedTabsState(suspendedTabsList, suspendedTabsViewerState.stats.filterMode);
  }

  return true;
}

async function unsuspendTabFromViewer(button, tabId, originalUrl) {
  const unsuspendText = getMessage('unsuspend') || 'Unsuspend';
  const unsuspendingText = getMessage('unsuspending') || 'Unsuspending...';

  try {
    button.disabled = true;
    button.textContent = unsuspendingText;

    await chrome.runtime.sendMessage({
      command: 'unsuspendTab',
      tabId: tabId,
      originalUrl: originalUrl
    });

    showNotice(getMessage('tabUnsuspended') || 'Tab unsuspended successfully', 'success', 2000);

    const removed = removeSuspendedTabRow(tabId);
    if (!removed) {
      await showSuspendedTabs();
    }
  } catch (error) {
    console.error('Failed to unsuspend tab:', error);
    showNotice(getMessage('unsuspendFailed') || 'Failed to unsuspend tab: ' + error.message, 'error', 3000);
    button.disabled = false;
    button.textContent = unsuspendText;
  }
}

async function handleSuspendedTabsListClick(event) {
  const button = event.target.closest('.unsuspend-tab-btn');
  if (!button) {
    return;
  }

  event.preventDefault();

  if (button.disabled) {
    return;
  }

  const tabId = Number.parseInt(button.getAttribute('data-tab-id'), 10);
  if (!Number.isFinite(tabId)) {
    return;
  }

  const originalUrl = button.getAttribute('data-original-url') || '';
  await unsuspendTabFromViewer(button, tabId, originalUrl);
}

function handleSuspendedTabFaviconError(event) {
  const target = event.target;
  if (target && target.classList && target.classList.contains('suspended-tab-favicon-img')) {
    target.style.display = 'none';
  }
}

function resetSuspendedTabsInfo() {
  const suspendedTabsInfo = document.getElementById('suspendedTabsInfo');
  const suspendedTabsCount = document.getElementById('suspendedTabsCount');
  const suspendedTabsList = document.getElementById('suspendedTabsList');
  const showSuspendedTabsBtn = document.getElementById('showSuspendedTabsBtn');

  suspendedTabsViewerState.renderToken += 1;
  suspendedTabsViewerState.stats.totalTabs = 0;
  suspendedTabsViewerState.stats.suspendedCount = 0;
  suspendedTabsViewerState.stats.discardedCount = 0;
  suspendedTabsViewerState.stats.undiscardedSuspendedCount = 0;
  suspendedTabsViewerState.stats.unsuspendedCount = 0;
  suspendedTabsViewerState.stats.matchedCount = 0;
  suspendedTabsViewerState.stats.filterMode = getSelectedTabViewerFilter();

  if (suspendedTabsInfo) {
    suspendedTabsInfo.style.display = 'none';
  }

  if (suspendedTabsCount) {
    suspendedTabsCount.textContent = '';
  }

  if (suspendedTabsList) {
    suspendedTabsList.innerHTML = '';
  }

  setSuspendedTabsButtonState(showSuspendedTabsBtn, false);
}

async function showSuspendedTabs() {
  const showSuspendedTabsBtn = document.getElementById('showSuspendedTabsBtn');
  const suspendedTabsInfo = document.getElementById('suspendedTabsInfo');
  const suspendedTabsCount = document.getElementById('suspendedTabsCount');
  const suspendedTabsList = document.getElementById('suspendedTabsList');

  if (!showSuspendedTabsBtn || !suspendedTabsInfo || !suspendedTabsCount || !suspendedTabsList) {
    return;
  }

  const filterMode = getSelectedTabViewerFilter();
  const renderToken = suspendedTabsViewerState.renderToken + 1;
  suspendedTabsViewerState.renderToken = renderToken;

  try {
    setSuspendedTabsButtonState(showSuspendedTabsBtn, true);
    showNotice(getMessage('scanningSuspendedTabs') || 'Scanning for suspended tabs...', 'info', 2000);

    const allTabs = await chrome.tabs.query({});
    if (renderToken !== suspendedTabsViewerState.renderToken) {
      return;
    }

    const suspendedPrefix = chrome.runtime.getURL('suspended.html');
    const viewModel = buildSuspendedTabsViewModel(allTabs, suspendedPrefix, filterMode);

    suspendedTabsViewerState.stats.totalTabs = viewModel.totalTabs;
    suspendedTabsViewerState.stats.suspendedCount = viewModel.suspendedCount;
    suspendedTabsViewerState.stats.discardedCount = viewModel.discardedCount;
    suspendedTabsViewerState.stats.undiscardedSuspendedCount = viewModel.undiscardedSuspendedCount;
    suspendedTabsViewerState.stats.unsuspendedCount = viewModel.unsuspendedCount;
    suspendedTabsViewerState.stats.matchedCount = viewModel.matchedCount;
    suspendedTabsViewerState.stats.filterMode = viewModel.filterMode;

    updateSuspendedTabsCountDisplay();
    suspendedTabsInfo.style.display = 'block';

    await displaySuspendedTabsList(viewModel, suspendedTabsList, renderToken);
    if (renderToken !== suspendedTabsViewerState.renderToken) {
      return;
    }

    const loadedText = getMessage('suspendedTabsLoaded') || 'Suspended tabs information loaded';
    showNotice(`${loadedText} (${viewModel.matchedCount}/${viewModel.totalTabs})`, 'success', 3000);
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error loading suspended tabs:', error);
    showNotice(getMessage('errorLoadingSuspendedTabs') || 'Error loading suspended tabs: ' + error.message, 'error', 4000);

    suspendedTabsCount.textContent = getMessage('errorOccurred') || 'An error occurred';
    suspendedTabsCount.style.color = '#dc3545';
    suspendedTabsList.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #dc3545;">
        <div style="margin-top: 8px;">${escapeHtml(error.message)}</div>
      </div>
    `;
    suspendedTabsInfo.style.display = 'block';
  } finally {
    if (renderToken === suspendedTabsViewerState.renderToken) {
      setSuspendedTabsButtonState(showSuspendedTabsBtn, false);
    }
  }
}

/* ---------- End Suspended Tabs Information Functions ---------- */

// ==== Test-only export ====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEY,
    FAVICON_FIX_DEFAULT_BATCH_SIZE,
    VALID_THEME_MODES,
    COMMAND_DESCRIPTIONS,
    MIGRATION_CONFIGS,
    TAB_VIEWER_FILTER_SUSPENDED_ALL,
    TAB_VIEWER_FILTER_SUSPENDED_UNDISCARDED,
    TAB_VIEWER_FILTER_NOT_SUSPENDED,
    suspendedTabsViewerState,
    normalizeThemeMode,
    normalizeIndicatorMode,
    cacheThemeMode,
    escapeHtml,
    getMessage,
    isKnownExtensionTab,
    createCustomConfig,
    parseMarvellousTab,
    parseTabSuspenderTab,
    parseCustomTab,
    parseCommitsToChangelog,
    parseCommitMessage,
    getChangeIcon,
    getChangeColor,
    parseSuspendedTab,
    parseSessionFile,
    getDefaultSettings,
    getCurrentSettings,
    validateSettingsData,
    shouldIncludeTabInView,
    buildSuspendedTabsViewModel,
    buildSuspendedTabsCountText,
    getSuspendedTabsMessages,
    ProgressBarUtils,
    initializeElements,
    getNoticeContainer,
    showNotice,
    initNavigation,
    setVersion,
    load,
    loadWhitelist,
    getCurrentActiveSection,
    save,
    displayKeyboardShortcuts,
    renderChangelog,
    displayExtensionTabs,
    selectAllTabs,
    deselectAllTabs,
    updateMigrationProgress,
    hideMigrationProgress,
    clearDiscoveredIds,
    getDiscoveredIds: () => discoveredExtensionIds,
    scanForExtensionTabs,
    migrateSelectedTabs,
    getAllTabs,
    previewExport,
    exportSession,
    importSession,
    showImportProgress,
    updateImportProgress,
    handleSessionFileSelected,
    exportSettings,
    previewSettings,
    resetSettings,
    confirmResetSettings,
    handleSettingsFileSelected,
    createSuspendedWindowSection,
    createSuspendedTabItem,
    renderNoSuspendedTabsState,
    displaySuspendedTabsList,
    updateWindowHeaderCount,
    removeSuspendedTabRow,
    updateSuspendedTabsCountDisplay,
    getSelectedTabViewerFilter,
    showSuspendedTabs,
    handleSuspendedTabsListClick,
    handleSuspendedTabFaviconError,
    unsuspendTabFromViewer,
    resetSuspendedTabsInfo,
    initSuspendedTabsViewerEvents,
    loadChangelog,
    previewSession,
    previewImportSettings,
    importSettings,
    resetSessionPreviews,
    resetSettingsPreviews,
    scanForCustomTabs,
    loadKeyboardShortcuts,
    testCustomPattern,
    handleExport,
    resetMigrationState,
    resetExtensionMigrationState,
  };
}