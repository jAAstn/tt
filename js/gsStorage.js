import  { gsSession }             from './gsSession.js';
import  { gsUtils }               from './gsUtils.js';

'use strict';

let _domainMapCache = null;
let _domainMapRaw   = null;

export const gsStorage = {
  SCREEN_CAPTURE                : 'screenCapture',
  SCREEN_CAPTURE_FORCE          : 'screenCaptureForce',
  SUSPEND_IN_PLACE_OF_DISCARD   : 'suspendInPlaceOfDiscard',
  UNSUSPEND_ON_FOCUS            : 'gsUnsuspendOnFocus',
  SUSPEND_TIME                  : 'gsTimeToSuspend',
  IGNORE_WHEN_OFFLINE           : 'onlineCheck',
  IGNORE_WHEN_CHARGING          : 'batteryCheck',
  CLAIM_BY_DEFAULT              : 'claimByDefault',
  IGNORE_PINNED                 : 'gsDontSuspendPinned',
  IGNORE_FORMS                  : 'gsDontSuspendForms',
  IGNORE_AUDIO                  : 'gsDontSuspendAudio',
  IGNORE_ACTIVE_TABS            : 'gsDontSuspendActiveTabs',
  IGNORE_CACHE                  : 'gsIgnoreCache',
  ADD_CONTEXT                   : 'gsAddContextMenu',
  SYNC_SETTINGS                 : 'gsSyncSettings',
  NO_NAG                        : 'gsNoNag',
  THEME                         : 'gsTheme',
  WHITELIST                     : 'gsWhitelist',
  // NEW: Domain-specific suspend times
  // Format: "domain.com=5\nother.com=10" (minutes, same values as SUSPEND_TIME)
  DOMAIN_SUSPEND_TIMES          : 'gsDomainSuspendTimes',

  DISCARD_AFTER_SUSPEND         : 'discardAfterSuspend',
  DISCARD_IN_PLACE_OF_SUSPEND   : 'discardInPlaceOfSuspend',

  APP_VERSION                   : 'gsVersion',
  LAST_NOTICE                   : 'gsNotice',
  LAST_EXTENSION_RECOVERY       : 'gsExtensionRecovery',
  UPDATE_AVAILABLE              : 'gsUpdateAvailable',

  DEFAULT_FAVICON_FINGERPRINTS  : 'gsDefaultFaviconFingerprints',

  noop: function() {},

  getSettingsDefaults: function() {
    const defaults = {};
    defaults[gsStorage.SCREEN_CAPTURE] = '0';
    defaults[gsStorage.SCREEN_CAPTURE_FORCE] = false;
    defaults[gsStorage.SUSPEND_IN_PLACE_OF_DISCARD] = false;
    defaults[gsStorage.DISCARD_IN_PLACE_OF_SUSPEND] = false;
    defaults[gsStorage.DISCARD_AFTER_SUSPEND] = false;
    defaults[gsStorage.IGNORE_WHEN_OFFLINE] = false;
    defaults[gsStorage.IGNORE_WHEN_CHARGING] = false;
    defaults[gsStorage.CLAIM_BY_DEFAULT] = false;
    defaults[gsStorage.UNSUSPEND_ON_FOCUS] = false;
    defaults[gsStorage.IGNORE_PINNED] = true;
    defaults[gsStorage.IGNORE_FORMS] = true;
    defaults[gsStorage.IGNORE_AUDIO] = true;
    defaults[gsStorage.IGNORE_ACTIVE_TABS] = true;
    defaults[gsStorage.IGNORE_CACHE] = false;
    defaults[gsStorage.ADD_CONTEXT] = true;
    defaults[gsStorage.SYNC_SETTINGS] = true;
    defaults[gsStorage.SUSPEND_TIME] = '60';
    defaults[gsStorage.NO_NAG] = false;
    defaults[gsStorage.WHITELIST] = '';
    defaults[gsStorage.THEME] = 'system';
    defaults[gsStorage.UPDATE_AVAILABLE] = false;
    defaults[gsStorage.DOMAIN_SUSPEND_TIMES] = '';

    return defaults;
  },

  /**
   * Parse the DOMAIN_SUSPEND_TIMES string into a map of { domain -> minutes }
   * Format per line: "domain.com=60"  or  "domain.com = 60"
   * Lines starting with # are comments and are ignored.
   * @param {string} rawString
   * @returns {Record<string, number>}
   */
parseDomainSuspendTimes: function(rawString) {
    if (rawString === _domainMapRaw && _domainMapCache !== null) {
      return _domainMapCache;
    }
    _domainMapRaw = rawString;
    
    const map = {};
    if (!rawString) {
      _domainMapCache = map;
      return map;
    }
    
    const lines = rawString.split(/[\r\n]+/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const domain = trimmed.substring(0, eqIdx).trim().toLowerCase();
      const minutes = parseFloat(trimmed.substring(eqIdx + 1).trim());
      if (domain && !isNaN(minutes) && minutes >= 0) {
        map[domain] = minutes;
      }
    }
    _domainMapCache = map;
    return map;
  },

  /**
   * Given a tab URL, return the domain-specific suspend time in minutes,
   * or null if no domain rule matches.
   * @param {string} url
   * @param {string} domainSuspendTimesRaw
   * @returns {number|null}
   */
  getDomainSuspendTimeForUrl: function(url, domainSuspendTimesRaw) {
    if (!url || !domainSuspendTimesRaw) return null;
    const map = gsStorage.parseDomainSuspendTimes(domainSuspendTimesRaw);
    if (Object.keys(map).length === 0) return null;

    let hostname = '';
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch (e) {
      return null;
    }

    // Try exact match first, then progressively strip subdomains
    // e.g. "sub.example.com" → try "sub.example.com", "example.com", "com"
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.');
      if (map.hasOwnProperty(candidate)) {
        return map[candidate];
      }
    }
    return null;
  },

  /**
   * LOCAL STORAGE FUNCTIONS
   */

  //populate local storage settings with sync settings where undefined
  initSettingsAsPromised: function() {
    return new Promise(function(resolve) {
      var defaultSettings = gsStorage.getSettingsDefaults();
      var defaultKeys = Object.keys(defaultSettings);
      chrome.storage.sync.get(defaultKeys, async (syncedSettings) => {
        gsUtils.log('gsStorage', 'syncedSettings on init: ', syncedSettings);
        await gsSession.setSynchedSettingsOnInit(syncedSettings);

        chrome.storage.local.get(['gsSettings'], async (result) => {

          var rawLocalSettings;
          try {
            rawLocalSettings = JSON.parse(result.gsSettings || null);
          } catch (e) {
            gsUtils.error( 'gsStorage', 'Failed to parse gsSettings: ', result, );
          }
          if (!rawLocalSettings) {
            rawLocalSettings = {};
          } else {
            rawLocalSettings[gsStorage.SYNC_SETTINGS] =
              rawLocalSettings[gsStorage.SYNC_SETTINGS] || false;
          }
          gsUtils.log('gsStorage', 'localSettings on init: ', rawLocalSettings);
          var shouldSyncSettings = rawLocalSettings[gsStorage.SYNC_SETTINGS];

          var mergedSettings = {};
          for (const key of defaultKeys) {
            if (key === gsStorage.SYNC_SETTINGS) {
              if (chrome.extension.inIncognitoContext) {
                mergedSettings[key] = false;
              } else {
                mergedSettings[key] = rawLocalSettings.hasOwnProperty(key)
                  ? rawLocalSettings[key]
                  : defaultSettings[key];
              }
              continue;
            }
            if (
              key === gsStorage.NO_NAG &&
              shouldSyncSettings &&
              rawLocalSettings.hasOwnProperty(gsStorage.NO_NAG) &&
              rawLocalSettings[gsStorage.NO_NAG]
            ) {
              mergedSettings[gsStorage.NO_NAG] = true;
              continue;
            }
            if (
              syncedSettings.hasOwnProperty(key) &&
              (!rawLocalSettings.hasOwnProperty(key) || shouldSyncSettings)
            ) {
              mergedSettings[key] = syncedSettings[key];
            }
            if (!mergedSettings.hasOwnProperty(key)) {
              mergedSettings[key] = rawLocalSettings[key];
            }
            if (
              typeof mergedSettings[key] === 'undefined' ||
              mergedSettings[key] === null
            ) {
              gsUtils.warning( 'gsStorage', 'Missing key: ' + key + '! Will init with default.' );
              mergedSettings[key] = defaultSettings[key];
            }
          }
          await gsStorage.saveSettings(mergedSettings);
          gsUtils.log('gsStorage', 'mergedSettings: ', mergedSettings);

          var triggerResync = false;
          for (const key of defaultKeys) {
            if (
              key !== gsStorage.SYNC_SETTINGS &&
              syncedSettings[key] !== mergedSettings[key]
            ) {
              triggerResync = true;
            }
          }
          if (triggerResync) {
            await gsStorage.syncSettings();
          }
          gsStorage.addSettingsSyncListener();
          gsUtils.log('gsStorage', 'init successful');
          resolve();

        });

      });
    });
  },

  addSettingsSyncListener: function() {
    chrome.storage.onChanged.addListener(async (remoteSettings, namespace) => {
      if (namespace !== 'sync' || !remoteSettings) {
        return;
      }
      const shouldSync = await gsStorage.getOption(gsStorage.SYNC_SETTINGS);
      if (shouldSync) {
        const localSettings = await gsStorage.getSettings();
        var changedSettingKeys = [];
        var oldValueBySettingKey = {};
        var newValueBySettingKey = {};
        Object.keys(remoteSettings).forEach(function(key) {
          var remoteSetting = remoteSettings[key];
          if (key === gsStorage.NO_NAG) {
            if (remoteSetting.newValue === false) {
              return false;
            }
          }
          if (localSettings[key] !== remoteSetting.newValue) {
            gsUtils.log( 'gsStorage', 'Changed value from sync', key, remoteSetting.newValue );
            changedSettingKeys.push(key);
            oldValueBySettingKey[key] = localSettings[key];
            newValueBySettingKey[key] = remoteSetting.newValue;
            localSettings[key] = remoteSetting.newValue;
          }
        });

        if (changedSettingKeys.length > 0) {
          await gsStorage.saveSettings(localSettings);
          gsUtils.performPostSaveUpdates(
            changedSettingKeys,
            oldValueBySettingKey,
            newValueBySettingKey,
          );
        }
      }
    });
  },

  getOption: async (prop) => {
    const settings = await gsStorage.getSettings();
    if (typeof settings[prop] === 'undefined' || settings[prop] === null) {
      settings[prop] = gsStorage.getSettingsDefaults()[prop];
      await gsStorage.saveSettings(settings);
    }
    return settings[prop];
  },

  setOption: async (prop, value) => {
    const settings = await gsStorage.getSettings();
    settings[prop] = value;
    await gsStorage.saveSettings(settings);
  },

setOptionAndSync: async (prop, value) => {
    if (prop === gsStorage.DOMAIN_SUSPEND_TIMES) {
      _domainMapCache = null;
      _domainMapRaw   = null;
    }
    await gsStorage.setOption(prop, value);
    await gsStorage.syncSettings();
  },

  getStorageJSON: async (store, name) => {
    const result = await chrome.storage[store].get([name]);
    let value;
    try {
      value = JSON.parse(result[name] || null);
    } catch (e) {
      gsUtils.error( 'gsStorage', 'Failed to parse gsSettings: ', result );
    }
    return value;
  },

  saveStorage: async (store, name, value) => {
    await chrome.storage[store].set({ [name]: JSON.stringify(value) });
    if (chrome.runtime.lastError) {
      gsUtils.error( 'gsStorage', 'failed to save to local storage', chrome.runtime.lastError );
    }
  },

  deleteStorage: async (store, name) => {
    await chrome.storage[store].remove([name]);
    if (chrome.runtime.lastError) {
      gsUtils.error( 'gsStorage', 'failed to remove from local storage', chrome.runtime.lastError );
    }
  },

  getSettings: async () => {
    let settings = await gsStorage.getStorageJSON('local', 'gsSettings');
    if (!settings) {
      settings = gsStorage.getSettingsDefaults();
      await gsStorage.saveSettings(settings);
    }
    return settings;
  },

  saveSettings: async (settings) => {
    return gsStorage.saveStorage('local', 'gsSettings', settings);
  },

  getTabState: async (tabId) => {
    return gsStorage.getStorageJSON('session', `gsTab${tabId}`);
  },

  saveTabState: async (tabId, state) => {
    if (!tabId) {
      gsUtils.error('saveTabState', 'Missing tabId');
      return;
    }
    gsStorage.saveStorage('session', `gsTab${tabId}`, state);
  },

  deleteTabState: async (tabId) => {
    await chrome.storage.session.remove([`gsTab${tabId}`]);
    if (chrome.runtime.lastError) {
      gsUtils.error( 'gsStorage', 'failed delete from local storage', chrome.runtime.lastError );
    }
  },

  syncSettings: async () => {
    const settings = await gsStorage.getSettings();
    if (settings[gsStorage.SYNC_SETTINGS]) {
      delete settings[gsStorage.SYNC_SETTINGS];
      gsUtils.log('gsStorage', 'gsStorage', 'Pushing local settings to sync', settings);
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          gsUtils.error('gsStorage', 'failed to save to chrome.storage.sync: ', chrome.runtime.lastError);
        }
      });
    }
  },

  fetchLastVersion: function() {
    return new Promise((resolve) => {
      chrome.storage.local.get([gsStorage.APP_VERSION], (result) => {
        var version;
        try {
          version = JSON.parse(result[gsStorage.APP_VERSION] || null);
        } catch (e) {
          gsUtils.error(
            'gsStorage',
            'Failed to parse ' + gsStorage.APP_VERSION + ': ',
            result,
          );
        }
        version = version || '0.0.0';
        resolve(version + '');
      });
    });
  },

  setLastVersion: function(newVersion) {
    chrome.storage.local.set({ [gsStorage.APP_VERSION]: JSON.stringify(newVersion) }, () => {
      if (chrome.runtime.lastError) {
        gsUtils.error(
          'gsStorage',
          'failed to save ' + gsStorage.APP_VERSION + ' to local storage',
          chrome.runtime.lastError
        );
      }
    });
  },

  setNoticeVersion: function(newVersion) {
    chrome.storage.local.set({ [gsStorage.LAST_NOTICE]: JSON.stringify(newVersion) }, () => {
      if (chrome.runtime.lastError) {
        gsUtils.error(
          'gsStorage',
          'failed to save ' + gsStorage.LAST_NOTICE + ' to local storage',
          chrome.runtime.lastError
        );
      }
    });
  },

  fetchLastExtensionRecoveryTimestamp: function() {
    return new Promise((resolve) => {
      chrome.storage.local.get([gsStorage.LAST_EXTENSION_RECOVERY], (result) => {
        var lastExtensionRecoveryTimestamp;
        try {
          lastExtensionRecoveryTimestamp = JSON.parse(result[gsStorage.LAST_EXTENSION_RECOVERY] || null);
        } catch (e) {
          gsUtils.error(
            'gsStorage',
            'Failed to parse ' + gsStorage.LAST_EXTENSION_RECOVERY + ': ',
            result,
          );
        }
        resolve(lastExtensionRecoveryTimestamp);
      });
    });
  },

  setLastExtensionRecoveryTimestamp: function(extensionRecoveryTimestamp) {
    chrome.storage.local.set({ [gsStorage.LAST_EXTENSION_RECOVERY]: JSON.stringify(extensionRecoveryTimestamp) }, () => {
      if (chrome.runtime.lastError) {
        gsUtils.error(
          'gsStorage',
          'failed to save ' +
          gsStorage.LAST_EXTENSION_RECOVERY +
          ' to local storage',
          chrome.runtime.lastError
        );
      }
    });
  },

};
