// options.js - handle save/load settings with modern UI navigation
const STORAGE_KEY = 'utsSettings';
const CACHE_THEME_KEY = 'utsCacheThemeMode';
const VALID_THEME_MODES = new Set(['auto', 'light', 'dark']);
const VALID_INDICATOR_MODES = new Set(['favicon', 'titlePrefix']);
const FAVICON_FIX_DEFAULT_BATCH_SIZE = 50;

// Shared command description map for i18n lookups
const COMMAND_DESCRIPTIONS = {
  '01-toggle-suspend': { key: 'shortcutToggleSuspend', default: 'Suspend/Unsuspend active tab' },
  '02-toggle-pause': { key: 'shortcutTogglePause', default: 'Pause/Unpause suspension of active tab' },
  '03-suspend-selected': { key: 'shortcutSuspendSelected', default: 'Suspend selected tabs' },
  '04-unsuspend-selected': { key: 'shortcutUnsuspendSelected', default: 'Unsuspend selected tabs' },
  '05-suspend-others-window': { key: 'suspendOthers', default: 'Suspend all other tabs in active window' },
  '06-force-suspend-others-window': { key: 'forceSuspendOthers', default: 'Force suspend all other tabs in active window' },
  '07-unsuspend-all-window': { key: 'unsuspendAllThisWindow', default: 'Unsuspend all tabs in active window' },
  '08-suspend-all-all-windows': { key: 'suspendAllOthersAllWindows', default: 'Suspend all tabs in all windows' },
  '09-force-suspend-all-all-windows': { key: 'forceSuspendAll', default: 'Force suspend all tabs in all windows' },
  '10-unsuspend-all-all-windows': { key: 'unsuspendAll', default: 'Unsuspend all tabs in all windows' },
  '11-go-to-session-manager': { key: 'goToSessionManager', default: 'Go to session manager' }
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
let fixFaviconEnabledEl, fixFaviconBatchSizeEl, fixFaviconMaxRetriesEl, suspendBatchConcurrencyEl, suspendedIndicatorModeEl;
let customSuspendTimesEl; // <-- Das hier muss irgendwo bei den 'let's stehen!

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
  customSuspendTimesEl = document.getElementById('customSuspendTimesList');
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

// Apply the theme to this page immediately (theme-boot.js only runs on load).
function applyDocumentTheme(themeMode) {
  const mode = normalizeThemeMode(themeMode);
  const resolved = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
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
    // Announce notices to screen readers without stealing focus
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
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
  // Explicitly set initial width to ensure starting state
  progress.style.width = '100%';
  progress.style.transition = `width ${duration}ms linear`;
  notice.appendChild(progress);

  // Append to DOM BEFORE triggering animation to guarantee visibility
  container.appendChild(notice);

  // Double rAF to ensure layout. Guarantees width change happens after element is rendered.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progress.style.width = '0%';
    });
  });

  // Fallback safety in case rAF is skipped (e.g., background tab)
  setTimeout(() => {
    if (progress.style.width !== '0%') {
      progress.style.width = '0%';
    }
  }, 50);
  
  // Auto close notice
  const close = () => {
    notice.classList.add('hide');
    setTimeout(() => notice.remove(), 250); // match fadeOut duration
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
      
      // Remove active class from all links and sections
      navLinks.forEach(l => {
        l.classList.remove('active');
        l.removeAttribute('aria-current');
      });
      sections.forEach(s => s.classList.remove('active'));

      // Add active class to clicked link
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
      
      // Show corresponding section
      const sectionId = link.getAttribute('data-section');
      const targetSection = document.getElementById(sectionId);
      if (targetSection) {
        targetSection.classList.add('active');
      }
      
      // Reset migration state when switching to migration section
      if (sectionId === 'migration') {
        resetMigrationState();
      }
      

      
      // Auto-reload whitelist when switching to whitelist section
      if (sectionId === 'whitelist') {
        loadWhitelist(false);
      }
      
      // Load changelog when switching to changelog section
      if (sectionId === 'changelog') {
        loadChangelog();
      }
      
      // Load shortcuts when switching to shortcuts section
      if (sectionId === 'shortcuts') {
        loadKeyboardShortcuts();
      }
      
      // Reset session previews when switching to session section
      if (sectionId === 'session') {
        resetSessionPreviews();
      }
      
      // Reset settings previews when switching to settings section
      if (sectionId === 'settings') {
        resetSettingsPreviews();
      }
      
      // Reset suspended tabs info when switching to tab list section
      if (sectionId === 'tabviewer') {
        resetSuspendedTabsInfo();
      }
      
      // Show the save bar only on sections that contain savable form settings
      const FORM_SECTIONS = ['basic', 'advanced', 'whitelist'];
      actionBar.style.display = FORM_SECTIONS.includes(sectionId) ? 'flex' : 'none';
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
    discardEl.checked = cfg.useNativeDiscard !== false; // default true
    whitelistEl.value = (cfg.whitelist || []).join('\n');
    // Load new suspension prevention settings with defaults
    neverSuspendAudioEl.checked = cfg.neverSuspendAudio !== false; // default true
    neverSuspendPinnedEl.checked = cfg.neverSuspendPinned !== false; // default true
    neverSuspendActiveEl.checked = cfg.neverSuspendActive === true; // default false
    rememberLastActiveTabEl.checked = cfg.rememberLastActiveTab !== false; // default true
    clickAnywhereToUnsuspendEl.checked = cfg.clickAnywhereToUnsuspend === true; // default false
    // Load theme settings with default to 'auto'
    themeModeEl.value = normalizeThemeMode(cfg.themeMode); // default to auto (follow system)
    // Suspended-tab indicator with default to transparent favicon
    suspendedIndicatorModeEl.value = normalizeIndicatorMode(cfg.suspendedIndicatorMode);
    // Favicon fix settings
    fixFaviconEnabledEl.checked = cfg.fixFaviconEnabled !== false;
    fixFaviconBatchSizeEl.value = (typeof cfg.fixFaviconBatchSize === 'number' ? cfg.fixFaviconBatchSize : FAVICON_FIX_DEFAULT_BATCH_SIZE);
    fixFaviconMaxRetriesEl.value = (typeof cfg.fixFaviconMaxRetries === 'number' ? cfg.fixFaviconMaxRetries : 5);
    suspendBatchConcurrencyEl.value = (typeof cfg.suspendBatchConcurrency === 'number' ? cfg.suspendBatchConcurrency : 5);
if (customSuspendTimesEl) {
    customSuspendTimesEl.value = (cfg.customSuspendTimes || []).join('\n');
}
  });
}

// Load only whitelist from storage
function loadWhitelist(showNotification = true) {
  chrome.storage.sync.get(STORAGE_KEY, data => {
    const cfg = data[STORAGE_KEY] || {};
    whitelistEl.value = (cfg.whitelist || []).join('\n');
    
    // --- DIESEN BLOCK NEU HINZUFÜGEN ---
    if (customSuspendTimesEl) {
      customSuspendTimesEl.value = (cfg.customSuspendTimes || []).join('\n');
    }
    // -----------------------------------
    
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
  
  // Load existing settings first
  chrome.storage.sync.get(STORAGE_KEY, data => {
    const existingCfg = data[STORAGE_KEY] || {};
    let updatedCfg = { ...existingCfg };
    
    // Only update settings for the current active section
    switch (currentSection) {
      case 'basic':
        updatedCfg.autoSuspendMinutes = parseFloat(autoSuspendEl.value.replace(',', '.')) || 0;
        updatedCfg.useNativeDiscard = discardEl.checked;
        updatedCfg.neverSuspendAudio = neverSuspendAudioEl.checked;
        updatedCfg.neverSuspendPinned = neverSuspendPinnedEl.checked;
        updatedCfg.neverSuspendActive = neverSuspendActiveEl.checked;
        updatedCfg.rememberLastActiveTab = rememberLastActiveTabEl.checked;
        updatedCfg.clickAnywhereToUnsuspend = clickAnywhereToUnsuspendEl.checked;
        break;
      case 'advanced':
        updatedCfg.themeMode = normalizeThemeMode(themeModeEl.value);
        updatedCfg.suspendedIndicatorMode = normalizeIndicatorMode(suspendedIndicatorModeEl.value);
        updatedCfg.fixFaviconEnabled = fixFaviconEnabledEl.checked;
        updatedCfg.fixFaviconBatchSize = parseInt(fixFaviconBatchSizeEl.value, 10) || 0;
        updatedCfg.fixFaviconMaxRetries = parseInt(fixFaviconMaxRetriesEl.value, 10);
        updatedCfg.suspendBatchConcurrency = Math.max(1, parseInt(suspendBatchConcurrencyEl.value, 10) || 5);
        break;
case 'whitelist':
        updatedCfg.whitelist = whitelistEl.value.split(/\n/).map(s => s.trim()).filter(Boolean);
        updatedCfg.customSuspendTimes = customSuspendTimesEl.value.split(/\n/).map(s => s.trim()).filter(Boolean); // <--- HIER MUSS ES STEHEN
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
        };
    }

    // Keep the suspended page cache valid even when saving non-theme sections.
    cacheThemeMode(updatedCfg.themeMode);
    applyDocumentTheme(updatedCfg.themeMode);

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
  
  // Load shortcuts when visiting the shortcuts section
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
      <div style="text-align: center; padding: 20px; color: var(--danger-text);">
        <span data-i18n="errorLoadingShortcuts">Error loading shortcuts</span>
      </div>
    `;
  }
}

// Display keyboard shortcuts in the UI
function displayKeyboardShortcuts(commands, container) {
  if (!commands || commands.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted);">
        <span data-i18n="noShortcutsFound">No shortcuts found</span>
      </div>
    `;
    return;
  }
  
  // Filter out built-in Chrome commands like _execute_action
  const filteredCommands = commands.filter(command => 
    !command.name.startsWith('_execute_')
  );
  
  if (filteredCommands.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted);">
        <span data-i18n="noShortcutsFound">No shortcuts found</span>
      </div>
    `;
    return;
  }
  
  // Use shared command description map for i18n
  const commandDescriptions = COMMAND_DESCRIPTIONS;
  
  const html = filteredCommands.map(command => {
    const description = commandDescriptions[command.name];
    const displayName = description ? (getMessage(description.key) || description.default) : command.description;
    const shortcut = command.shortcut || getMessage('notAssigned') || 'Not assigned';
    const isAssigned = !!command.shortcut;
    
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; margin-bottom: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md);">
        <div style="flex: 1;">
          <div style="font-weight: 500; color: var(--text-body);">${escapeHtml(displayName)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="padding: 6px 12px; background: ${isAssigned ? 'var(--tint-info-bg)' : 'var(--surface-hover)'}; color: ${isAssigned ? 'var(--tint-info-text)' : 'var(--text-muted)'}; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; font-family: var(--font-mono); min-width: 120px; text-align: center;">
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
      'klbibkeccnjlkjkiokjodocebajanakg', // Original The Marvellous Suspender
      'noogafoofpebimajpfpamcfhoaifemoa', // Alternative version  
      'gcknhkkoolaabfmlnjonogaaifnjlfnp', // Another known ID
      'ahfhijdlegdabablpippeagghigmibma', // Newer version
      'jlgkpaicikihijadgifklkbpdajbkhjo', // Community fork
      'ahkbmjhfoplmfkpncgoedjgkajkehcgo', // The Great Suspender (notrack)
      'plpkmjcnhhnpkblimgenmdhghfgghdpp', // The Great-er Tab Discarder
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
    knownExtensionIds: [], // Will be populated dynamically
    urlPattern: '', // Will be set dynamically
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

// Cache for dynamically discovered extension IDs
let discoveredExtensionIds = new Set();

// Initialize tab migration functionality
function initTabMigration() {
  // Initialize Marvellous Suspender migration
  initExtensionMigration('marvellous');
  
  // Initialize Tab Suspender migration
  initExtensionMigration('tabSuspender');
  
  // Initialize Custom migration
  initCustomMigration();
}

// Generic function to initialize migration for a specific extension
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

// Initialize custom migration functionality
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

// Test the custom pattern configuration
function testCustomPattern() {
  const extensionId = document.getElementById('customExtensionId').value.trim();
  const path = document.getElementById('customPath').value.trim();
  const separator = document.getElementById('customSeparator').value;
  const titleParam = document.getElementById('customTitleParam').value.trim();
  const urlParam = document.getElementById('customUrlParam').value.trim();
  
  // Validate inputs
  if (!extensionId || !path || !titleParam || !urlParam) {
    showNotice(getMessage('fillAllFields') || 'Please fill in all fields', 'warning');
    return;
  }
  
  // Generate example URL
  const exampleUrl = `chrome-extension://${extensionId}/${path}${separator}${titleParam}=${encodeURIComponent('Example Page Title')}&${urlParam}=${encodeURIComponent('https://example.com')}`;
  
  // Test parsing
  const customConfig = createCustomConfig();
  const parsedTab = parseCustomTab(exampleUrl);
  
  if (parsedTab) {
    showNotice(getMessage('patternTestSuccess') || 'Pattern test successful! Example URL parsed correctly.', 'success');
    console.log('[ZeroRAM Suspender] Custom pattern test result:', parsedTab);
  } else {
    showNotice(getMessage('patternTestFailed') || 'Pattern test failed. Please check your configuration.', 'error');
  }
}

// Create custom configuration based on user input
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

// Scan for custom extension tabs
async function scanForCustomTabs() {
  const customConfig = createCustomConfig();
  
  // Validate inputs
  if (!customConfig.extensionId || !customConfig.path || !customConfig.titleParam || !customConfig.urlParam) {
    showNotice(getMessage('fillAllFields') || 'Please fill in all fields', 'warning');
    return;
  }
  
  // Update the custom configuration
  MIGRATION_CONFIGS.custom.knownExtensionIds = [customConfig.extensionId];
  MIGRATION_CONFIGS.custom.urlPattern = `/${customConfig.path}${customConfig.separator}`;
  MIGRATION_CONFIGS.custom.name = `Custom Extension (${customConfig.extensionId.substring(0, 8)}...)`;
  
  // Perform scan using the generic function
  await scanForExtensionTabs('custom');
}

// Generic function to check if URL is from a known extension
function isKnownExtensionTab(url, extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config || !url || !url.startsWith('chrome-extension://')) {
    return false;
  }
  
  // Check URL pattern based on extension type
  let matchesPattern = false;
  if (extensionKey === 'tabSuspender') {
    // Check for both Tab Suspender URL patterns
    matchesPattern = url.includes('/park.html?') || url.includes('/suspended.html?');
  } else if (extensionKey === 'custom') {
    // For custom extension, check if configuration is available
    const customConfig = createCustomConfig();
    matchesPattern = customConfig.extensionId && 
                    url.includes(customConfig.extensionId) && 
                    url.includes(`/${customConfig.path}${customConfig.separator}`);
  } else {
    // For other extensions, use the single pattern
    matchesPattern = url.includes(config.urlPattern);
  }
  
  if (!matchesPattern) {
    return false;
  }
  
  // Extract extension ID from URL
  const matches = url.match(/chrome-extension:\/\/([a-z]+)\//);
  if (!matches || matches.length < 2) {
    return false;
  }
  
  const extensionId = matches[1];
  return config.knownExtensionIds.includes(extensionId) || discoveredExtensionIds.has(extensionId);
}

// Parse Marvellous Suspender tab format
function parseMarvellousTab(url) {
  try {
    if (!url || !url.startsWith('chrome-extension://') || !url.includes('/suspended.html#')) {
      return null;
    }
    
    const hashPart = url.split('#')[1];
    if (!hashPart) {
      return null;
    }
    
    // Check if it has the characteristic Marvellous Suspender parameters
    const params = new URLSearchParams(hashPart);
    const title = params.get('ttl');
    const position = params.get('pos');
    
    // --- NEU: Manueller Substring-Fix für die URI ---
    // Verhindert, dass un-escapte '&' in der Ziel-URL von URLSearchParams als 
    // neue Parameter interpretiert und somit abgeschnitten werden.
    let originalUrl = null;
    const uriIndex = hashPart.indexOf('uri=');
    if (uriIndex !== -1) {
      originalUrl = hashPart.substring(uriIndex + 4); 
    }
    
    // Must have 'ttl' and 'uri' parameters to be considered a potential match
    if (!originalUrl || !params.has('ttl')) {
      return null;
    }
    
    // Extract extension ID
    const matches = url.match(/chrome-extension:\/\/([a-z]+)\/suspended\.html#/);
    const extensionId = matches ? matches[1] : 'unknown';
    
    // Safely decode title with fallback
    let decodedTitle = originalUrl; // Fallback, falls kein Titel da ist
    if (title) {
      try {
        decodedTitle = decodeURIComponent(title);
      } catch (decodeError) {
        // If decoding fails, try to decode as much as possible or use the original
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

// Parse Tab Suspender tab format
function parseTabSuspenderTab(url) {
  try {
    if (!url || !url.startsWith('chrome-extension://')) {
      return null;
    }
    
    // Check for both Tab Suspender variants
    let isVariant1 = url.includes('fiabciakcmgepblmdkmemdbbkilneeeh/park.html?');
    let isVariant2 = url.includes('laameccjpleogmfhilmffpdbiibgbekf/suspended.html?');
    
    if (!isVariant1 && !isVariant2) {
      return null;
    }
    
    const urlObj = new URL(url);
    const title = urlObj.searchParams.get('title');
    const originalUrl = urlObj.searchParams.get('url');
    
    // Must have both 'title' and 'url' parameters
    if (!originalUrl || !title) {
      return null;
    }
    
    // Extract extension ID from URL
    let extensionId = '';
    if (isVariant1) {
      extensionId = 'fiabciakcmgepblmdkmemdbbkilneeeh';
    } else if (isVariant2) {
      extensionId = 'laameccjpleogmfhilmffpdbiibgbekf';
    }
    
    // Safely decode parameters
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

// Parse custom extension tab format
function parseCustomTab(url) {
  try {
    if (!url || !url.startsWith('chrome-extension://')) {
      return null;
    }
    
    const customConfig = createCustomConfig();
    
    // Check if URL matches the custom pattern
    if (!url.includes(`/${customConfig.path}${customConfig.separator}`)) {
      return null;
    }
    
    // Check if the extension ID matches
    if (!url.includes(customConfig.extensionId)) {
      return null;
    }
    
    let title, originalUrl;
    
    if (customConfig.separator === '?') {
      // Parse as query string
      const urlObj = new URL(url);
      title = urlObj.searchParams.get(customConfig.titleParam);
      originalUrl = urlObj.searchParams.get(customConfig.urlParam);
    } else {
      // Parse as hash fragment
      const hashPart = url.split('#')[1];
      if (!hashPart) {
        return null;
      }
      
      const params = new URLSearchParams(hashPart);
      title = params.get(customConfig.titleParam);
      originalUrl = params.get(customConfig.urlParam);
    }
    
    // Must have both title and URL parameters
    if (!originalUrl || !title) {
      return null;
    }
    
    // Safely decode parameters
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

// Generic function to scan for extension tabs
async function scanForExtensionTabs(extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config) return;
  
  const scanBtn = document.getElementById(config.ui.scanBtnId);
  const resultsDiv = document.getElementById(config.ui.resultsId);
  const statusDiv = document.getElementById(config.ui.statusId);
  const tabsListDiv = document.getElementById(config.ui.tabsListId);
  const tabsContainer = document.getElementById(config.ui.tabsContainerId);
  
  // Disable scan button and show loading
  scanBtn.disabled = true;
  scanBtn.style.opacity = '0.6';
  statusDiv.textContent = getMessage('scanningTabs');
  statusDiv.style.color = 'var(--text-muted)';
  resultsDiv.style.display = 'block';
  tabsListDiv.style.display = 'none';
  
  try {
    // Query all tabs
    const tabs = await chrome.tabs.query({});
    const foundTabs = [];
    const detectedExtensionIds = new Set();
    
    for (const tab of tabs) {
      // Skip our own extension's tabs
      if (tab.url && tab.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
        continue;
      }
      
      // Check URL pattern based on extension type
      let shouldParse = false;
      if (extensionKey === 'tabSuspender') {
        // Check for both Tab Suspender URL patterns
        shouldParse = tab.url && (tab.url.includes('/park.html?') || tab.url.includes('/suspended.html?'));
      } else if (extensionKey === 'custom') {
        // For custom extension, check if configuration is available
        const customConfig = createCustomConfig();
        shouldParse = tab.url && customConfig.extensionId && 
                     tab.url.includes(customConfig.extensionId) && 
                     tab.url.includes(`/${customConfig.path}${customConfig.separator}`);
      } else {
        // For other extensions, use the single pattern
        shouldParse = tab.url && tab.url.includes(config.urlPattern);
      }
      
      if (shouldParse) {
        // Parse tab using the appropriate parser
        let parsedTab = null;
        if (config.parseFunction === 'parseMarvellousTab') {
          parsedTab = parseMarvellousTab(tab.url);
        } else if (config.parseFunction === 'parseTabSuspenderTab') {
          parsedTab = parseTabSuspenderTab(tab.url);
        } else if (config.parseFunction === 'parseCustomTab') {
          parsedTab = parseCustomTab(tab.url);
        }
        
        if (parsedTab) {
          // Check if this extension ID is in our known list
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
          
          // Add to discovered IDs if it's unknown
          if (!isKnownVariant) {
            discoveredExtensionIds.add(parsedTab.extensionId);
          }
        }
      }
    }
    
    // Log detected extension IDs for debugging
    if (detectedExtensionIds.size > 0) {
      console.log(`[ZeroRAM Suspender] Detected ${config.name} extension IDs:`, Array.from(detectedExtensionIds));
    }
    
    // Update status and display results
    if (foundTabs.length === 0) {
      const noTabsFoundKey = extensionKey === 'marvellous' ? 'noMarvellousTabFound' : 'noTabSuspenderTabFound';
      statusDiv.textContent = getMessage(noTabsFoundKey) || `No ${config.name} tabs found`;
      statusDiv.style.color = 'var(--text-muted)';
    } else {
      const knownVariants = foundTabs.filter(tab => !tab.isUnknownVariant).length;
      const unknownVariants = foundTabs.filter(tab => tab.isUnknownVariant).length;
      
      const foundTabsKey = extensionKey === 'marvellous' ? 'foundMarvellousTab' : 'foundTabSuspenderTab';
      let statusText = (getMessage(foundTabsKey) || `Found %d ${config.name} tabs`).replace('%d', foundTabs.length);
      if (unknownVariants > 0) {
        statusText += ` (${unknownVariants} ${getMessage('unknownVariant') || 'unknown variant'})`;
      }
      
      statusDiv.textContent = statusText;
      statusDiv.style.color = 'var(--success-text)';
      
      // Display tabs list
      displayExtensionTabs(foundTabs, tabsContainer);
      tabsListDiv.style.display = 'block';
    }
  } catch (error) {
    console.error(`[ZeroRAM Suspender] Error scanning ${config.name} tabs:`, error);
    statusDiv.textContent = (getMessage('errorScanningTabs') || 'Error scanning tabs: ') + error.message;
    statusDiv.style.color = 'var(--danger-text)';
  } finally {
    // Re-enable scan button
    scanBtn.disabled = false;
    scanBtn.style.opacity = '1';
  }
}

// Generic function to display found extension tabs
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
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      transition: background-color 0.2s ease, border-color 0.2s ease;
    `;
    
    const variantBadge = tabData.isUnknownVariant 
      ? `<span style="background: var(--warning); color: #1E293B; padding: 2px 6px; border-radius: var(--radius-sm); font-size: 10px; margin-left: 8px;">${getMessage('unknownVariant') || 'Unknown Variant'}</span>`
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
        <div style="font-weight: 500; color: var(--text-body); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center;">
          ${tabData.favIconUrl ? `<img class="migration-tab-favicon-img" src="${escapeHtml(tabData.favIconUrl)}" style="width: 16px; height: 16px; margin-right: 8px; flex-shrink: 0;">` : ''}${escapeHtml(tabData.title)}${variantBadge}
        </div>
        <div style="font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(tabData.originalUrl)}
        </div>
        <div style="font-size: 10px; color: var(--text-faint); margin-top: 2px;">
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

// Generic function to select all tabs in a container
function selectAllTabs(containerId) {
  const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]`);
  checkboxes.forEach(checkbox => {
    checkbox.checked = true;
  });
}

// Generic function to deselect all tabs in a container
function deselectAllTabs(containerId) {
  const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]`);
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
}

// Generic progress bar utility functions for extension migrations
const ProgressBarUtils = {
  // Update progress display with flexible configuration
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
    
    // Show progress container
    progressContainer.style.display = 'block';
    
    // Update progress text
    if (customText) {
      progressText.textContent = customText;
    } else if (showPercentage) {
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
      progressText.textContent = `${completed}/${total} (${percentage}%)`;
    } else {
      progressText.textContent = `${completed}/${total}`;
    }
    
    // Update progress bar fill
    const percentage = total > 0 ? (completed / total) * 100 : 0;
    progressFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    
    return true;
  },
  
  // Hide progress display
  hideProgress: function(containerSelector = '#migrationProgressContainer') {
    const progressContainer = document.querySelector(containerSelector);
    if (progressContainer) {
      progressContainer.style.display = 'none';
      return true;
    }
    return false;
  },
  
  // Reset progress to initial state
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
    
    // Hide after reset
    setTimeout(() => {
      this.hideProgress(containerSelector);
    }, 100);
  }
};

// wrapper functions for migration
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

// Generic function to migrate selected tabs
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
    // Disable migrate button
    migrateBtn.disabled = true;
    migrateBtn.style.opacity = '0.6';
    
    // Initialize progress bar using the extension-specific elements
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
        
        // Create the new suspended URL for ZeroRAM Suspender
        let suspendedUrl = chrome.runtime.getURL('suspended.html') + 
          '?uri=' + encodeURIComponent(originalUrl) +
          '&ttl=' + encodeURIComponent(title);
        
        // Add favicon if available
        if (favIconUrl && favIconUrl !== 'chrome://favicon/') {
          suspendedUrl += '&favicon=' + encodeURIComponent(favIconUrl);
        }
        
        // Update the tab to use ZeroRAM Suspender format
        await chrome.tabs.update(tabId, { url: suspendedUrl });
        successCount++;
      } catch (error) {
        console.error(`[ZeroRAM Suspender] Error migrating ${config.name} tab:`, error);
        failureCount++;
      }
      
      // Update progress after each tab is processed
      processedCount++;
      ProgressBarUtils.updateProgress({
        completed: processedCount,
        total: totalTabs,
        containerSelector: `#${config.ui.progressContainerId}`,
        textSelector: `#${config.ui.progressTextId}`,
        fillSelector: `#${config.ui.progressFillId}`
      });
      
      // Add a small delay to make progress visible and avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Show completion message
    if (successCount > 0) {
      const migrationCompleteMsg = getMessage('migrationComplete') || 'Migration completed';
      const tabsMigratedMsg = getMessage('tabsMigrated') || ' tabs migrated';
      showNotice(`${migrationCompleteMsg} (${successCount}${tabsMigratedMsg})`, 'success');
      
      // Refresh the tab list after a short delay
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
    // Hide progress bar and re-enable migrate button after a short delay
    setTimeout(() => {
      ProgressBarUtils.hideProgress(`#${config.ui.progressContainerId}`);
      migrateBtn.disabled = false;
      migrateBtn.style.opacity = '1';
    }, 1000);
  }
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Utility function to get message (fallback for i18n)
function getMessage(key) {
  return chrome.i18n ? chrome.i18n.getMessage(key) : key;
}

// Reset migration state when switching to migration section
function resetMigrationState() {
  // Reset Marvellous Suspender migration state
  resetExtensionMigrationState('marvellous');
  
  // Reset Tab Suspender migration state
  resetExtensionMigrationState('tabSuspender');
  
  // Reset Custom migration state
  resetExtensionMigrationState('custom');
  
  console.log('[ZeroRAM Suspender] All migration states reset');
}

// Generic function to reset migration state for a specific extension
function resetExtensionMigrationState(extensionKey) {
  const config = MIGRATION_CONFIGS[extensionKey];
  if (!config) return;
  
  const resultsDiv = document.getElementById(config.ui.resultsId);
  const statusDiv = document.getElementById(config.ui.statusId);
  const tabsListDiv = document.getElementById(config.ui.tabsListId);
  const tabsContainer = document.getElementById(config.ui.tabsContainerId);
  const scanBtn = document.getElementById(config.ui.scanBtnId);
  
  // Hide results and reset content
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
  
  // Reset scan button state
  if (scanBtn) {
    scanBtn.disabled = false;
    scanBtn.style.opacity = '1';
  }
  
  console.log(`[ZeroRAM Suspender] ${config.name} migration state reset`);
}

// Clear discovered extension IDs cache (for testing purposes)
function clearDiscoveredIds() {
  discoveredExtensionIds.clear();
  console.log('[ZeroRAM Suspender] Cleared discovered extension IDs cache');
}

// Export for potential use in console debugging
if (typeof window !== 'undefined') {
  window.ZeroRAMSuspenderDebug = {
    clearDiscoveredIds,
    resetMigrationState,
    resetExtensionMigrationState,
    getMigrationConfigs: () => MIGRATION_CONFIGS,
    getDiscoveredIds: () => Array.from(discoveredExtensionIds),
    scanForExtensionTabs,
    // Export progress utilities for testing and future use
    ProgressBarUtils
  };
}

/* ---------- End Tab Migration Functions ---------- */

/* ---------- Change Log Functions ---------- */

// Load and display changelog from GitHub API
async function loadChangelog() {
  const changelogContent = document.getElementById('changelogContent');
  
  try {
    // Show loading state
    changelogContent.innerHTML = `
      <div class="loading-state" style="text-align: center; padding: 40px; color: var(--text-muted);">
        <div style="margin-bottom: 12px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg></div>
        <span data-i18n="loadingChanges">Loading change log...</span>
      </div>
    `;
    
    // Fetch commits from local CHANGELOG.json file
    const response = await fetch(chrome.runtime.getURL('CHANGELOG.json'));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const commits = await response.json();
    
    // Parse commits and extract version changes
    const changelog = parseCommitsToChangelog(commits);
    
    if (changelog.length === 0) {
      changelogContent.innerHTML = `
        <div class="empty-state">
          <div class="icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5M9 13h6M9 17h4"></path></svg></div>
          <h3 data-i18n="noChangesFound">No version changes found</h3>
        </div>
      `;
      return;
    }
    
    // Render changelog
    renderChangelog(changelog, changelogContent);
    
  } catch (error) {
    console.error('Failed to load changelog:', error);
    changelogContent.innerHTML = `
      <div class="empty-state">
        <div class="icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M15 9l-6 6M9 9l6 6"></path></svg></div>
        <h3 data-i18n="failedToLoadChanges">Failed to load change log</h3>
        <p style="color: var(--text-faint); font-size: 12px;">${error.message}</p>
      </div>
    `;
  }
}

// Parse commits and group by version
function parseCommitsToChangelog(commits) {
  const changelog = [];
  let currentVersion = null;
  let currentChanges = [];
  
  // Check if there's an explicit 1.0.0 version update
  const hasExplicitV100 = commits.some(commit => 
    /(?:Update version to|chore:\s*update version to)\s*1\.0\.0/i.test(commit.commit.message)
  );
  
  for (const commit of commits) {
    const message = commit.commit.message;
    const date = new Date(commit.commit.author.date);
    
    // Check if this is a version update commit
    const versionMatch = message.match(/(?:Update version to|chore:\s*update version to)\s*([\d.]+)/i);
    
    // Check if this is the initial commit (should be 1.0.0)
    const isInitialCommit = message === 'Initial commit';
    
    if (versionMatch) {
      // Save previous version changes if any
      if (currentVersion && currentChanges.length > 0) {
        changelog.push({
          version: currentVersion.version,
          date: currentVersion.date,
          changes: currentChanges
        });
      }
      
      // Start new version
      currentVersion = {
        version: versionMatch[1],
        date: date
      };
      currentChanges = [];
    } else if (isInitialCommit && !hasExplicitV100) {
      // Save previous version changes if any
      if (currentVersion && currentChanges.length > 0) {
        changelog.push({
          version: currentVersion.version,
          date: currentVersion.date,
          changes: currentChanges
        });
      }
      
      // Start 1.0.0 for initial commit
      currentVersion = {
        version: '1.0.0',
        date: date
      };
      currentChanges = [
        { type: 'added', description: 'Initial release', sha: commit.sha.substring(0, 7), url: commit.html_url }
      ];
    } else if (currentVersion) {
      // Add change to current version
      const change = parseCommitMessage(message, commit);
      if (change) {
        currentChanges.push(change);
      }
    } else {
      // Changes without version (for latest unreleased changes)
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
  
  // Add final version
  if (currentVersion && currentChanges.length > 0) {
    changelog.push({
      version: currentVersion.version,
      date: currentVersion.date,
      changes: currentChanges
    });
  }
  
  return changelog;
}

// Parse individual commit message to extract meaningful changes
function parseCommitMessage(message, commit) {
  // Skip version update commits and merge commits
  if (message.includes('Update version to') || 
      /chore:\s*update version to/i.test(message) || 
      message.startsWith('Merge ')) {
    return null;
  }
  
  // Clean up the message and get first line only
  const description = message.split('\n')[0].trim();
  
  let type = 'changed';
  let finalDescription = description;
  
  const ccMatch = description.match(/^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (ccMatch) {
    const ccType = ccMatch[1].toLowerCase();
    const ccScope = ccMatch[2];
    const ccSubject = ccMatch[3].trim();
    
    // Capitalize the first letter of the subject
    const capitalizedSubject = ccSubject.charAt(0).toUpperCase() + ccSubject.slice(1);

    // Add scope in brackets if present
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
      // Determine type based on first word of the subject
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
    // Non-Conventional Commit
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

// Render changelog to DOM
function renderChangelog(changelog, container) {
  const html = changelog.map(version => {
    // Group changes by type
    const changesByType = version.changes.reduce((groups, change) => {
      const type = change.type;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(change);
      return groups;
    }, {});
    
    // Define display order for change types
    const typeOrder = ['added', 'improved', 'fixed', 'removed', 'changed'];
    
    // Generate HTML for each type group in order
    const changesHtml = typeOrder.map(type => {
      if (!changesByType[type] || changesByType[type].length === 0) {
        return '';
      }
      
      const typeChanges = changesByType[type].map(change => {
        const icon = getChangeIcon(change.type);
        return `
          <li class="changelog-item" style="margin-bottom: 8px; display: flex; align-items: flex-start; gap: 8px;">
            <span style="display: inline-flex; margin-top: 2px; width: 16px; justify-content: center; flex-shrink: 0; color: ${getChangeColor(change.type)};">${icon}</span>
            <div style="flex: 1;">
              <span style="font-weight: 500; color: ${getChangeColor(change.type)}; text-transform: capitalize;">${change.type}:</span>
              <span style="margin-left: 4px;">${escapeHtml(change.description)}</span>
              <a href="${change.url}" target="_blank" style="margin-left: 8px; color: var(--brand-text); text-decoration: none; font-size: 11px; opacity: 0.7;">${change.sha}</a>
            </div>
          </li>
        `;
      }).join('');
      
      return typeChanges;
    }).filter(html => html !== '').join('');
    
    return `
      <div class="card" style="margin-bottom: 20px;">
        <h3 class="card-title" style="margin-bottom: 16px;">
          <span style="font-size: 18px; font-weight: 600;">${version.version}</span>
          <span style="margin-left: auto; color: var(--text-muted); font-size: 12px; font-weight: normal;">
            ${version.date.toLocaleDateString()}
          </span>
        </h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${changesHtml}
        </ul>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

// Get icon for change type (inline SVG, stroke follows currentColor)
function getChangeIcon(type) {
  const svg = (paths) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icons = {
    added: svg('<path d="M12 3l1.9 5.1 5.1 1.9-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"></path>'),
    fixed: svg('<circle cx="12" cy="13" r="6"></circle><path d="M12 7v12M12 7a3 3 0 0 1 3-3M12 7a3 3 0 0 0-3-3M6 13H3M21 13h-3M7.5 8.5L5 6M16.5 8.5L19 6M7.5 17.5L5 20M16.5 17.5L19 20"></path>'),
    changed: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4"></path><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4"></path>'),
    removed: svg('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"></path>'),
    improved: svg('<path d="M13 2L4.5 13H11l-1 9 8.5-11H12z"></path>'),
    security: svg('<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>')
  };
  return icons[type] || svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5M9 13h6M9 17h4"></path>');
}

// Get color for change type
function getChangeColor(type) {
  // Semantic -text tokens clear WCAG AA on the page surface in both themes
  const colors = {
    added: 'var(--success-text)',
    fixed: 'var(--danger-text)',
    changed: 'var(--info-text)',
    removed: 'var(--text-muted)',
    improved: 'var(--tint-warning-text)',
    security: 'var(--danger-text)'
  };
  return colors[type] || 'var(--text-muted)';
}

/* ---------- End Change Log Functions ---------- */


/* ---------- Session Management Functions ---------- */

// Reset session management previews
function resetSessionPreviews() {
  // Reset export preview
  const exportPreview = document.getElementById('exportPreview');
  if (exportPreview) {
    exportPreview.style.display = 'none';
  }

  // Reset import preview
  const sessionPreview = document.getElementById('sessionPreview');
  if (sessionPreview) {
    sessionPreview.style.display = 'none';
  }

  // Reset file input
  const sessionFileInput = document.getElementById('sessionFileInput');
  if (sessionFileInput) {
    sessionFileInput.value = '';
  }

  // Reset the Saved Sessions name input. We intentionally do NOT re-pull the
  // saved-sessions list here: re-render on initSavedSessions() already keeps
  // it in sync with storage, and doing it on every section toggle would
  // lose any in-progress selection state the user hasn't acted on yet.
  const savedSessionName = document.getElementById('savedSessionName');
  if (savedSessionName) {
    savedSessionName.value = '';
  }
  const importAsSuspended = document.getElementById('importAsSuspended');
  if (importAsSuspended && typeof importAsSuspended.checked === 'boolean') {
    importAsSuspended.checked = true; // reset to default
  }
}

// Initialize session management functionality
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

  // The new "Saved Sessions" card lives in this section too; its DOM is
  // already in the page by the time DOMContentLoaded fires (init runs then).
  if (typeof initSavedSessions === 'function') {
    initSavedSessions();
  }
}

// Parse suspended tab URL to get original URL and title
function parseSuspendedTab(url) {
  try {
    // Check if it's our extension's suspended page
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

// Get all tabs from all windows with proper handling of suspended tabs
async function getAllTabs() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    return windows.map(window => {
      return window.tabs.map(tab => {
        // Check if this is a suspended tab and extract original info
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

// Handle export button click
function handleExport() {
  const formatSelect = document.getElementById('exportFormat');
  const format = formatSelect ? formatSelect.value : 'txt';
  exportSession(format);
}

// Preview export content
async function previewExport() {
  const formatSelect = document.getElementById('exportFormat');
  const format = formatSelect ? formatSelect.value : 'txt';
  
  try {
    showNotice(getMessage('generatingPreview') || 'Generating preview...', 'info', 1000);
    
    const windowTabs = await getAllTabs();
    let content = '';

    if (format === 'txt') {
      // TXT format: one URL per line, windows separated by blank lines
      content = windowTabs.map(windowTabs => 
        windowTabs.map(tab => tab.url).join('\n')
      ).join('\n\n');
      
    } else if (format === 'json') {
      // JSON format: array of windows with tab objects
      const sessionData = windowTabs.map(windowTabs => 
        windowTabs.map(tab => ({
          title: tab.title,
          url: tab.url
        }))
      );
      
      content = JSON.stringify(sessionData, null, 2);
    }

    // Display preview
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

// Export session in specified format
async function exportSession(format) {
  try {
    showNotice(getMessage('exportingSession') || 'Exporting session...', 'info', 2000);
    
    const windowTabs = await getAllTabs();
    let content = '';
    let filename = '';
    let mimeType = '';

    if (format === 'txt') {
      // TXT format: one URL per line, windows separated by blank lines
      content = windowTabs.map(windowTabs => 
        windowTabs.map(tab => tab.url).join('\n')
      ).join('\n\n');
      
      filename = `session_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      mimeType = 'text/plain';
      
    } else if (format === 'json') {
      // JSON format: array of windows with tab objects
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

    // Create and download file
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

// Handle session file selection
function handleSessionFileSelected(event) {
  const sessionPreview = document.getElementById('sessionPreview');
  
  // Reset session preview when file selection changes
  if (sessionPreview) {
    sessionPreview.style.display = 'none';
  }
}

// Parse session file content
function parseSessionFile(content, filename) {
  const isJson = filename.toLowerCase().endsWith('.json');
  
  if (isJson) {
    try {
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        // Validate JSON structure
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
    // Parse TXT format
    const lines = content.split('\n');
    const windows = [];
    let currentWindow = [];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        // Empty line indicates new window
        if (currentWindow.length > 0) {
          windows.push(currentWindow);
          currentWindow = [];
        }
      // } else if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://') || trimmedLine.startsWith('ftp://')) {  // Valid URL
      } else {
        currentWindow.push({
          title: trimmedLine,
          url: trimmedLine
        });
      }
    }
    
    // Add last window if not empty
    if (currentWindow.length > 0) {
      windows.push(currentWindow);
    }
    
    return windows;
  }
}

// Preview session content
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
    
    // Display preview
    const previewContainer = document.getElementById('sessionPreview');
    const previewContent = document.getElementById('sessionPreviewContent');
    
    let previewHtml = '';
    sessionData.forEach((windowTabs, windowIndex) => {
      previewHtml += `<div style="margin-bottom: 16px;">`;
      previewHtml += `<div style="font-weight: bold; color: var(--brand-text); margin-bottom: 8px;">${getMessage('window') || 'Window'} ${windowIndex + 1} (${windowTabs.length} ${getMessage('tabs') || 'tabs'})</div>`;
      
      windowTabs.forEach((tab, tabIndex) => {
        previewHtml += `<div style="margin-left: 16px; margin-bottom: 4px;">`;
        previewHtml += `<span style="color: var(--text-muted); font-size: 11px;">${tabIndex + 1}.</span> `;
        previewHtml += `<span style="font-weight: 500;">${escapeHtml(tab.title)}</span><br/>`;
        previewHtml += `<span style="margin-left: 16px; color: var(--text-faint); font-size: 11px;">${escapeHtml(tab.url)}</span>`;
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

// Import session
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
    
    // Show progress
    showImportProgress(true);
    let totalTabs = 0;
    let completedTabs = 0;
    
    // Count total tabs
    sessionData.forEach(windowTabs => {
      totalTabs += windowTabs.length;
    });
    
    updateImportProgress(completedTabs, totalTabs);
    
    // Import each window
    for (const windowTabs of sessionData) {
      if (windowTabs.length === 0) continue;
      
      // Create new window with first tab
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
      
      // Add remaining tabs to the window
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
        
        // Small delay to prevent overwhelming the browser
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    
    showImportProgress(false);
    showNotice(getMessage('sessionImported') || `Session imported successfully (${totalTabs} tabs)`, 'success', 4000);
    
    // Reset file input
    fileInput.value = '';
    document.getElementById('sessionPreview').style.display = 'none';
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error importing session:', error);
    showImportProgress(false);
    showNotice(getMessage('importFailed') || 'Import failed: ' + error.message, 'error', 4000);
  }
}

// Show/hide import progress
function showImportProgress(show) {
  const container = document.getElementById('importProgressContainer');
  if (container) {
    container.style.display = show ? 'block' : 'none';
  }
}

// Update import progress
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

/* ---------- Saved Sessions Functions ---------- */
// Persistent, in-extension session storage: the user can keep multiple
// named sessions in `chrome.storage.local` (key: `utsSavedSessions`) and reopen
// them later — fully, per-window, or per-tab — without round-tripping a file.
//
//   Storage shape (single array; insertion order preserved):
//     utsSavedSessions: [
//       { id, name, createdAt, updatedAt,
//         windows: [{ tabs: [{ url, title, pinned }] }] }, ...
//     ]
//
//   Open scopes:
//     - 'all'    → recreate every captured window with `windows.create`
//     - 'window' → recreate one chosen window's tabs in a fresh window
//     - 'tab'    → open a single tab from the session in the current window
//
//   Pinned state: chrome.windows.create({ url: [...] }) does NOT preserve
//   `pinned`. We mirror that quirk by re-applying pinned flags via
//   chrome.tabs.update(id, { pinned: true }) on the new tabs after creation.
//
//   Skip rules: chrome://, chrome-extension:// (including our own
//   suspended.html placeholder), edge://, about: are NEVER captured or
//   reopened. The extension's own suspended.html URL is computed at
//   initSavedSessions() time and pushed into SAVED_SESSIONS_BLOCKED_URLS.
const SAVED_SESSIONS_KEY = 'utsSavedSessions';
const MAX_SAVED_SESSIONS = 50;
const SAVED_SESSIONS_BLOCKED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];
const SAVED_SESSIONS_BLOCKED_URLS = []; // populated by initSavedSessions
let savedSessionsInitialized = false;

function isBlockedSavedSessionUrl(url) {
  if (!url || typeof url !== 'string') return true;
  if (SAVED_SESSIONS_BLOCKED_URLS.some((prefix) => url.startsWith(prefix))) return true;
  if (SAVED_SESSIONS_BLOCKED_PREFIXES.some((prefix) => url.startsWith(prefix))) return true;
  return false;
}

// Build a new session shape from the live browser. `scope` is one of
// 'currentWindow' (only the focused window) or 'allWindows' (every window
// whose remaining-after-filter tab list is non-empty).
async function captureSavedSession(scope) {
  const allWindows = await chrome.windows.getAll({ populate: true });
  const sessionWindows = [];
  for (const win of allWindows) {
    const filteredTabs = (win.tabs || []).filter((t) => !isBlockedSavedSessionUrl(t.url));
    if (filteredTabs.length === 0) continue;
    sessionWindows.push({
      tabs: filteredTabs.map((t) => ({
        url: t.url,
        title: t.title || t.url || '',
        pinned: Boolean(t.pinned),
      })),
    });
    if (scope === 'currentWindow' && win.focused) break;
  }
  return sessionWindows;
}

function generateSavedSessionId() {
  return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSavedSessionName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadSavedSessions() {
  const result = await chrome.storage.local.get(SAVED_SESSIONS_KEY);
  const arr = result && result[SAVED_SESSIONS_KEY];
  return Array.isArray(arr) ? arr : [];
}

async function writeSavedSessions(sessions) {
  await chrome.storage.local.set({ [SAVED_SESSIONS_KEY]: sessions });
}

async function saveSavedSession(scope) {
  const nameEl = document.getElementById('savedSessionName');
  const typed = nameEl && nameEl.value ? nameEl.value.trim() : '';
  const name = typed || defaultSavedSessionName();

  showNotice(getMessage('savingSession') || 'Saving session...', 'info', 1000);

  try {
    const windows = await captureSavedSession(scope);
    if (windows.length === 0) {
      showNotice(getMessage('noTabsToSave') || 'No valid tabs to save', 'warning', 4000);
      return;
    }
    const existing = await loadSavedSessions();
    if (existing.length >= MAX_SAVED_SESSIONS) {
      const msg = (getMessage('savedSessionsLimitReached') || 'Saved sessions limit reached (max %d)').replace('%d', MAX_SAVED_SESSIONS);
      showNotice(msg, 'error', 5000);
      return;
    }
    const session = {
      id: generateSavedSessionId(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      captureScope: scope,
      windows,
    };
    await writeSavedSessions([session, ...existing]);
    if (nameEl) nameEl.value = '';
    const savedMsg = (getMessage('sessionSavedNotice') || 'Session "%s" saved (%d window%s, %d tab%s)')
      .replace('%s', name)
      .replace('%d', windows.length)
      .replace('%s', windows.length === 1 ? '' : 's')
      .replace('%d', windows.reduce((sum, w) => sum + w.tabs.length, 0))
      .replace('%s', (windows.reduce((sum, w) => sum + w.tabs.length, 0)) === 1 ? '' : 's');
    showNotice(savedMsg, 'success', 3000);
    await refreshSavedSessionList();
  } catch (err) {
    console.error('[ZeroRAM Suspender] Failed to save session:', err);
    showNotice((getMessage('saveSessionFailed') || 'Failed to save session: %s').replace('%s', err.message), 'error', 4000);
  }
}

async function refreshSavedSessionList() {
  const container = document.getElementById('savedSessionsList');
  if (!container) return;
  const sessions = await loadSavedSessions();
  renderSavedSessionList(container, sessions);
}

function renderSavedSessionList(container, sessions) {
  container.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'saved-session-empty';
    empty.textContent = getMessage('noSavedSessions') || 'No saved sessions yet. Use the buttons above to save your current window or all windows.';
    container.appendChild(empty);
    return;
  }
  for (const session of sessions) {
    container.appendChild(buildSavedSessionItem(session));
  }
}

function buildSavedSessionItem(session) {
  const item = document.createElement('div');
  item.className = 'saved-session-item';
  item.dataset.sessionId = session.id;

  const fmtDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const totalTabs = (session.windows || []).reduce((sum, w) => sum + ((w.tabs || []).length), 0);
  const winCount = (session.windows || []).length;
  const winLabel = winCount === 1 ? (getMessage('window') || 'window') : (getMessage('windows') || 'windows');
  const tabLabel = totalTabs === 1 ? (getMessage('tab') || 'tab') : (getMessage('tabs') || 'tabs');

  const meta = document.createElement('div');
  meta.className = 'saved-session-meta';

  const nameRow = document.createElement('div');
  nameRow.className = 'saved-session-name-row';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'saved-session-name';
  nameSpan.textContent = session.name || '';
  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn btn-secondary saved-session-action-btn';
  renameBtn.dataset.action = 'rename';
  renameBtn.textContent = getMessage('rename') || 'Rename';
  nameRow.append(nameSpan, renameBtn);

  const stats = document.createElement('div');
  stats.className = 'saved-session-stats';
  stats.textContent = `${fmtDate(session.createdAt)} \u00b7 ${winCount} ${winLabel} \u00b7 ${totalTabs} ${tabLabel}`;

  const winList = document.createElement('div');
  winList.className = 'saved-session-window-list';
  (session.windows || []).forEach((w, idx) => {
    const row = document.createElement('div');
    row.className = 'saved-session-window-row';

    const label = document.createElement('span');
    label.className = 'saved-session-window-label';
    const wLabel = (getMessage('window') || 'Window');
    label.textContent = `${wLabel} ${idx + 1} (${(w.tabs || []).length})`;
    row.appendChild(label);

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-info saved-session-action-btn';
    openBtn.dataset.action = 'openWindow';
    openBtn.dataset.windowIndex = String(idx);
    openBtn.textContent = getMessage('openWindow') || 'Open Window';
    row.appendChild(openBtn);

    // Per-window single-tab opener. Empty placeholder option means “no tab
    // selected” so the user can re-pick the same tab after opening it.
    const select = document.createElement('select');
    select.className = 'saved-session-tab-select';
    select.dataset.windowIndex = String(idx);
    select.style.marginLeft = '8px';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `\u2014 ${(getMessage('openTab') || 'Open Tab')} \u2014`;
    select.appendChild(placeholder);
    (w.tabs || []).forEach((t, tIdx) => {
      const opt = document.createElement('option');
      opt.value = String(tIdx);
      const labelText = (t.title || t.url || '').slice(0, 80);
      opt.textContent = `${tIdx + 1}. ${labelText}`;
      opt.title = t.url || '';
      select.appendChild(opt);
    });
    row.appendChild(select);
    winList.appendChild(row);
  });

  meta.append(nameRow, stats, winList);

  const actions = document.createElement('div');
  actions.className = 'saved-session-actions';
  const openAllBtn = document.createElement('button');
  openAllBtn.className = 'btn btn-primary saved-session-action-btn';
  openAllBtn.dataset.action = 'openAll';
  openAllBtn.textContent = getMessage('openAll') || 'Open All';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger saved-session-action-btn';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.textContent = getMessage('delete') || 'Delete';
  actions.append(openAllBtn, deleteBtn);

  item.append(meta, actions);
  return item;
}

async function handleSavedSessionListClick(event) {
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const item = action.closest('.saved-session-item');
  if (!item) return;
  event.preventDefault();

  const id = item.dataset.sessionId;
  const kind = action.dataset.action;

  if (kind === 'openAll') {
    await openSavedSession(id, { scope: 'all' });
  } else if (kind === 'openWindow') {
    const idx = parseInt(action.dataset.windowIndex, 10);
    await openSavedSession(id, { scope: 'window', windowIndex: idx });
  } else if (kind === 'rename') {
    await promptRenameSavedSession(id);
  } else if (kind === 'delete') {
    const confirmed = window.confirm(
      (getMessage('confirmDeleteSession') || 'Delete saved session "%s"? This cannot be undone.')
        .replace('%s', item.querySelector('.saved-session-name')?.textContent || '')
    );
    if (confirmed) {
      await deleteSavedSession(id);
    }
  }
}

async function handleSavedSessionListChange(event) {
  const select = event.target;
  if (!select || !select.classList.contains('saved-session-tab-select')) return;
  if (select.value === '') return;
  const item = select.closest('.saved-session-item');
  if (!item) return;
  const id = item.dataset.sessionId;
  const wIdx = parseInt(select.dataset.windowIndex, 10);
  const tIdx = parseInt(select.value, 10);
  select.value = '';
  await openSavedSession(id, { scope: 'tab', windowIndex: wIdx, tabIndex: tIdx });
}

async function promptRenameSavedSession(id) {
  const sessions = await loadSavedSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const current = sessions[idx];
  const newName = window.prompt(
    (getMessage('renameSessionPrompt') || 'Rename session "%s":').replace('%s', current.name),
    current.name
  );
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    showNotice(getMessage('renameSessionEmpty') || 'Session name cannot be empty', 'warning', 3000);
    return;
  }
  sessions[idx] = { ...current, name: trimmed, updatedAt: Date.now() };
  await writeSavedSessions(sessions);
  showNotice(getMessage('sessionRenamed') || 'Session renamed', 'success', 2000);
  await refreshSavedSessionList();
}

async function deleteSavedSession(id) {
  const sessions = await loadSavedSessions();
  await writeSavedSessions(sessions.filter((s) => s.id !== id));
  showNotice(getMessage('sessionDeleted') || 'Session deleted', 'success', 2000);
  await refreshSavedSessionList();
}

// Convert one captured session window into urls + pinned-index map for
// chrome.windows.create. Filter out any blocked URLs that crept in.
function collectOpenWindowPayload(sessionWindow) {
  const urls = [];
  const pinned = [];
  for (const t of (sessionWindow && sessionWindow.tabs) || []) {
    if (isBlockedSavedSessionUrl(t.url)) continue;
    urls.push(t.url);
    pinned.push(Boolean(t.pinned));
  }
  return { urls, pinned };
}

// Open a stored session at one of three granularities. Returns the number of
// tabs that were successfully created so callers can message the user.
async function openSavedSession(id, { scope, windowIndex, tabIndex } = {}) {
  const sessions = await loadSavedSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    showNotice(getMessage('sessionNotFound') || 'Saved session not found', 'error', 3000);
    return 0;
  }

  if (scope === 'tab') {
    const win = session.windows[windowIndex];
    const tab = win && win.tabs[tabIndex];
    if (!tab) return 0;
    if (isBlockedSavedSessionUrl(tab.url)) return 0;
    const current = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const wId = current && current[0] ? current[0].windowId : undefined;
    await chrome.tabs.create({ url: tab.url, active: false, windowId: wId });
    showNotice(getMessage('sessionOpenedSingleTab') || 'Tab opened', 'success', 2000);
    return 1;
  }

  const winsToOpen = scope === 'all'
    ? session.windows
    : [session.windows[windowIndex]].filter(Boolean);

  let totalOpened = 0;
  for (const win of winsToOpen) {
    const { urls, pinned } = collectOpenWindowPayload(win);
    if (urls.length === 0) continue;
    const newWin = await chrome.windows.create({ url: urls, focused: false });
    const created = newWin && Array.isArray(newWin.tabs) ? newWin.tabs : [];
    for (let i = 0; i < pinned.length && i < created.length; i += 1) {
      if (pinned[i]) {
        try {
          await chrome.tabs.update(created[i].id, { pinned: true });
        } catch (_) {
          // Pinning a single tab is non-critical; continue with the others.
        }
      }
    }
    totalOpened += urls.length;
  }

  if (totalOpened > 0) {
    const msg = (getMessage('sessionOpenedNotice') || 'Opened %d tab(s)').replace('%d', totalOpened);
    showNotice(msg, 'success', 3000);
  }
  return totalOpened;
}

function initSavedSessions() {
  if (savedSessionsInitialized) return;
  savedSessionsInitialized = true;

  // Block our own suspended.html URL so an unsuspended tab whose state is
  // currently a placeholder is not captured as the placeholder itself and
  // not re-opened as a placeholder later. We only push once.
  try {
    const suspendedUrl = chrome.runtime.getURL('suspended.html');
    if (suspendedUrl && !SAVED_SESSIONS_BLOCKED_URLS.includes(suspendedUrl)) {
      SAVED_SESSIONS_BLOCKED_URLS.push(suspendedUrl);
    }
  } catch (_) { /* chrome.* not available (test path) */ }

  const saveCurrentBtn = document.getElementById('saveCurrentWindowBtn');
  const saveAllBtn = document.getElementById('saveAllWindowsBtn');
  const listEl = document.getElementById('savedSessionsList');

  if (saveCurrentBtn) saveCurrentBtn.addEventListener('click', () => saveSavedSession('currentWindow'));
  if (saveAllBtn) saveAllBtn.addEventListener('click', () => saveSavedSession('allWindows'));
  if (listEl) {
    listEl.addEventListener('click', handleSavedSessionListClick);
    listEl.addEventListener('change', handleSavedSessionListChange);
  }

  // Always re-render on entry so deletions / renames done in another tab are
  // visible immediately. Cheap: at most MAX_SAVED_SESSIONS rows.
  refreshSavedSessionList();
}

/* ---------- End Saved Sessions Functions ---------- */

/* ---------- End Session Management Functions ---------- */


/* ---------- Settings Management Functions ---------- */

// Initialize settings management functionality
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

// Get default settings
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
	customSuspendTimes: []
  };
}

// Get current settings
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
		customSuspendTimes: cfg.customSuspendTimes || []
      };
      resolve(settings);
    });
  });
}

// Export settings
async function exportSettings() {
  try {
    showNotice(getMessage('exportingSettings') || 'Exporting settings...', 'info', 2000);
    
    const settings = await getCurrentSettings();
    // Include current keyboard shortcuts (read-only; Chrome does not allow setting them programmatically)
    let shortcuts = [];
    try {
      const commands = await chrome.commands.getAll();
      shortcuts = (commands || [])
        .filter(c => !c.name.startsWith('_execute_'))
        .filter(c => c.shortcut && c.shortcut.trim()) // only include assigned shortcuts
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
    
    // Create and download file
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

// Preview current settings
async function previewSettings() {
  try {
    showNotice(getMessage('generatingPreview') || 'Generating preview...', 'info', 1000);
    
    const settings = await getCurrentSettings();
    // Include current keyboard shortcuts in preview JSON
    let shortcuts = [];
    try {
      const commands = await chrome.commands.getAll();
      shortcuts = (commands || [])
        .filter(c => !c.name.startsWith('_execute_'))
        .filter(c => c.shortcut && c.shortcut.trim()) // only include assigned shortcuts
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
    
    // Display preview
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

// Handle settings file selection
function handleSettingsFileSelected(event) {
  const file = event.target.files[0];
  const importSettingsPreview = document.getElementById('importSettingsPreview');
  
  // Reset import preview when file selection changes
  if (importSettingsPreview) {
    importSettingsPreview.style.display = 'none';
  }
}

// Preview import settings
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
    
    // Validate settings structure
    if (!validateSettingsData(settingsData)) {
      throw new Error('Invalid settings file format');
    }
    
    // Display preview
    const previewContainer = document.getElementById('importSettingsPreview');
    const previewContent = document.getElementById('importSettingsPreviewContent');
    
    let previewText = `${getMessage('settingsFileInfo') || 'Settings File Information'}:\n`;
    
    // Format exported date to human readable format
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
    previewText += `• ${getMessage('themeSettings') || 'Theme'}: ${settingsData.themeMode || 'auto'} (${getMessage('theme' + (settingsData.themeMode || 'auto').charAt(0).toUpperCase() + (settingsData.themeMode || 'auto').slice(1)) || settingsData.themeMode || 'auto'})\n`;
    previewText += `• ${getMessage('whitelistTitle') || 'Whitelist'}: ${(settingsData.whitelist || []).length} ${getMessage('items') || 'items'}\n`;
    previewText += `• ${getMessage('clickAnywhereToUnsuspend') || 'Click anywhere on the suspended page to unsuspend'}: ${settingsData.clickAnywhereToUnsuspend === true ? getMessage('enabled') || 'Enabled' : getMessage('disabled') || 'Disabled'}\n`;
    if (Array.isArray(settingsData.shortcuts)) {
      const count = settingsData.shortcuts.length;
      previewText += `• ${getMessage('keyboardShortcuts') || 'Keyboard Shortcuts'}: ${count} ${getMessage('items') || 'items'}\n`;
      if (count > 0) {
        previewText += '\n' + (getMessage('keyboardShortcuts') || 'Keyboard Shortcuts') + ':\n';
        settingsData.shortcuts.forEach((sc, index) => {
          const key = sc.shortcut && sc.shortcut.trim() ? sc.shortcut : (getMessage('notAssigned') || 'Not assigned');
          const desc = COMMAND_DESCRIPTIONS[sc.name];
          const displayName = desc ? (getMessage(desc.key) || desc.default) : sc.name;
          previewText += `  ${index + 1}. ${displayName} -> ${key}\n`;
        });
      }
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

// Validate settings data structure
function validateSettingsData(data) {
  if (!data || typeof data !== 'object') return false;
  
  const requiredFields = ['autoSuspendMinutes', 'useNativeDiscard', 'neverSuspendAudio', 'neverSuspendPinned', 'neverSuspendActive', 'whitelist'];
  
  // themeMode is optional for backward compatibility
  return requiredFields.every(field => field in data);
}

// Import settings
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
    
    // Validate settings structure
    if (!validateSettingsData(settingsData)) {
      throw new Error('Invalid settings file format');
    }
    
    // Prepare settings object
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
      suspendBatchConcurrency: typeof settingsData.suspendBatchConcurrency === 'number' ? settingsData.suspendBatchConcurrency : 5
    };
    
    // Save theme mode to localStorage for suspended page caching
    cacheThemeMode(newSettings.themeMode);
    applyDocumentTheme(newSettings.themeMode);

    // Save to storage
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: newSettings }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    
    // Update UI
    load();
    
    showNotice(getMessage('settingsImported') || 'Settings imported successfully', 'success', 4000);
    
    // Reset file input
    fileInput.value = '';
    document.getElementById('importSettingsPreview').style.display = 'none';
    
  } catch (error) {
    console.error('[ZeroRAM Suspender] Error importing settings:', error);
    showNotice(getMessage('importFailed') || 'Import failed: ' + error.message, 'error', 4000);
  }
}

// Confirm reset settings
function confirmResetSettings() {
  const confirmMsg = getMessage('confirmResetSettings') || 'Are you sure you want to reset all settings to their default values? This action cannot be undone.';
  
  if (confirm(confirmMsg)) {
    resetSettings();
  }
}

// Reset settings to defaults
async function resetSettings() {
  try {
    const defaultSettings = getDefaultSettings();
    
    // Save to storage
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: defaultSettings }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    
    // Update UI
    load();
    
    showNotice(getMessage('settingsReset') || 'Settings have been reset to defaults', 'success', 4000);
    
    // Hide previews
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

// Reset settings previews when switching to settings section
function resetSettingsPreviews() {
  // Reset file input
  const settingsFileInput = document.getElementById('settingsFileInput');
  if (settingsFileInput) {
    settingsFileInput.value = '';
  }
  
  // Hide export preview
  const settingsPreview = document.getElementById('settingsPreview');
  if (settingsPreview) {
    settingsPreview.style.display = 'none';
  }
  
  // Hide import preview
  const importSettingsPreview = document.getElementById('importSettingsPreview');
  if (importSettingsPreview) {
    importSettingsPreview.style.display = 'none';
  }
  
  // Clear preview content
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
  suspendedTabsCount.style.color = suspendedTabsViewerState.stats.matchedCount > 0 ? 'var(--success-text)' : 'var(--text-muted)';
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
      <span class="suspended-tabs-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg></span>
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

// Reset suspended tabs information display
function resetSuspendedTabsInfo() {
  const suspendedTabsInfo = document.getElementById('suspendedTabsInfo');
  const suspendedTabsCount = document.getElementById('suspendedTabsCount');
  const suspendedTabsList = document.getElementById('suspendedTabsList');
  const showSuspendedTabsBtn = document.getElementById('showSuspendedTabsBtn');

  // Invalidate ongoing chunked rendering work.
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

// Show information about suspended tabs
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
    suspendedTabsCount.style.color = 'var(--danger-text)';
    suspendedTabsList.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--danger-text);">
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
// Inert at runtime (loaded as a classic script where `module` is undefined);
// under Jest it exposes the internals for unit testing.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // constants
    STORAGE_KEY,
    FAVICON_FIX_DEFAULT_BATCH_SIZE,
    VALID_THEME_MODES,
    COMMAND_DESCRIPTIONS,
    MIGRATION_CONFIGS,
    TAB_VIEWER_FILTER_SUSPENDED_ALL,
    TAB_VIEWER_FILTER_SUSPENDED_UNDISCARDED,
    TAB_VIEWER_FILTER_NOT_SUSPENDED,
    suspendedTabsViewerState,
    // pure helpers
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
    // DOM-bound functions
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
    // migration flows
    scanForExtensionTabs,
    migrateSelectedTabs,
    // session flows
    getAllTabs,
    previewExport,
    exportSession,
    importSession,
    showImportProgress,
    updateImportProgress,
    handleSessionFileSelected,
    // saved sessions
    SAVED_SESSIONS_KEY,
    MAX_SAVED_SESSIONS,
    SAVED_SESSIONS_BLOCKED_PREFIXES,
    SAVED_SESSIONS_BLOCKED_URLS,
    isBlockedSavedSessionUrl,
    captureSavedSession,
    generateSavedSessionId,
    defaultSavedSessionName,
    loadSavedSessions,
    writeSavedSessions,
    saveSavedSession,
    refreshSavedSessionList,
    renderSavedSessionList,
    buildSavedSessionItem,
    promptRenameSavedSession,
    deleteSavedSession,
    openSavedSession,
    collectOpenWindowPayload,
    initSavedSessions,
    handleSavedSessionListClick,
    handleSavedSessionListChange,
    // settings flows
    exportSettings,
    previewSettings,
    resetSettings,
    confirmResetSettings,
    handleSettingsFileSelected,
    // tab viewer rendering
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
    // more flows
    loadChangelog,
    previewSession,
    previewImportSettings,
    importSettings,
    resetSessionPreviews,
    resetSettingsPreviews,
    scanForCustomTabs,
    loadKeyboardShortcuts,
    loadWhitelist,
    testCustomPattern,
    handleExport,
    getCurrentActiveSection,
    getNoticeContainer,
    resetMigrationState,
    resetExtensionMigrationState,
  };
}
