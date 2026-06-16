import  { gsChrome }              from './gsChrome.js';
import  { gsStorage }             from './gsStorage.js';
import  { gsUtils }               from './gsUtils.js';

(() => {

  var elementPrefMap = {
    preview: gsStorage.SCREEN_CAPTURE,
    forceScreenCapture: gsStorage.SCREEN_CAPTURE_FORCE,
    suspendInPlaceOfDiscard: gsStorage.SUSPEND_IN_PLACE_OF_DISCARD,
    onlineCheck: gsStorage.IGNORE_WHEN_OFFLINE,
    batteryCheck: gsStorage.IGNORE_WHEN_CHARGING,
    unsuspendOnFocus: gsStorage.UNSUSPEND_ON_FOCUS,
    claimByDefault: gsStorage.CLAIM_BY_DEFAULT,
    discardAfterSuspend: gsStorage.DISCARD_AFTER_SUSPEND,
    dontSuspendPinned: gsStorage.IGNORE_PINNED,
    dontSuspendForms: gsStorage.IGNORE_FORMS,
    dontSuspendAudio: gsStorage.IGNORE_AUDIO,
    dontSuspendActiveTabs: gsStorage.IGNORE_ACTIVE_TABS,
    ignoreCache: gsStorage.IGNORE_CACHE,
    addContextMenu: gsStorage.ADD_CONTEXT,
    syncSettings: gsStorage.SYNC_SETTINGS,
    timeToSuspend: gsStorage.SUSPEND_TIME,
    theme: gsStorage.THEME,
    whitelist: gsStorage.WHITELIST,
    domainSuspendTimes: gsStorage.DOMAIN_SUSPEND_TIMES,
  };


  function selectComboBox(element, key) {
    var i, child;

    for (i = 0; i < element.children.length; i += 1) {
      child = element.children[i];
      if (child.value === key) {
        child.selected = 'true';
        break;
      }
    }
  }

  function initSettings() {
    gsStorage.getSettings().then((settings) => {

      var optionEls = document.getElementsByClassName('option'),
        pref,
        element,
        i;
      for (i = 0; i < optionEls.length; i++) {
        element = optionEls[i];
        pref = elementPrefMap[element.id];
        populateOption(element, settings[pref]);
      }

      addClickHandlers();

      setForceScreenCaptureVisibility(settings[gsStorage.SCREEN_CAPTURE] !== '0');
      setAutoSuspendOptionsVisibility(parseFloat(settings[gsStorage.SUSPEND_TIME]) > 0);
      setSyncNoteVisibility(!settings[gsStorage.SYNC_SETTINGS]);

      // Render the domain-suspend preview table
      renderDomainSuspendPreview(settings[gsStorage.DOMAIN_SUSPEND_TIMES] || '');

      let searchParams = new URL(location.href).searchParams;
      if (searchParams.has('firstTime')) {
        document
          .querySelector('.welcome-message')
          .classList.remove('reallyHidden');
        document.querySelector('#options-heading').classList.add('reallyHidden');
      }
    });
  }

  function addClickHandlers() {
    document.getElementById('preview').addEventListener('change', function() {
      if (this.value === '1' || this.value === '2') {
        chrome.permissions.request({
          origins: [
            'http://*/*',
            'https://*/*',
          ],
        }, function(granted) {
          if (chrome.runtime.lastError) {
            gsUtils.warning('addClickHandlers', chrome.runtime.lastError);
          }
          if (!granted) {
            let select = document.getElementById('preview');
            select.value = '0';
            select.dispatchEvent(new Event('change'));
          }
        });
      }
    });
  }

  function populateOption(element, value) {
    if (
      element.tagName === 'INPUT' &&
      element.hasAttribute('type') &&
      element.getAttribute('type') === 'checkbox'
    ) {
      element.checked = value;
    } else if (element.tagName === 'SELECT') {
      selectComboBox(element, value);
    } else if (element.tagName === 'TEXTAREA') {
      element.value = value;
    }
  }

  function getOptionValue(element) {
    if (
      element.tagName === 'INPUT' &&
      element.hasAttribute('type') &&
      element.getAttribute('type') === 'checkbox'
    ) {
      return element.checked;
    }
    if (element.tagName === 'SELECT') {
      return element.children[element.selectedIndex].value;
    }
    if (element.tagName === 'TEXTAREA') {
      return element.value;
    }
  }

  function setForceScreenCaptureVisibility(visible) {
    document.getElementById('forceScreenCaptureContainer').style.display = visible ? 'block' : 'none';
  }

  function setSyncNoteVisibility(visible) {
    document.getElementById('syncNote').style.display = visible ? 'block' : 'none';
  }

  function setAutoSuspendOptionsVisibility(visible) {
    Array.prototype.forEach.call(
      document.getElementsByClassName('autoSuspendOption'),
      function(el) {
        el.style.display = visible ? 'block' : 'none';
      },
    );
  }

// ============================================================
  // NEW: Render a live preview table of parsed domain rules
  // ============================================================
  function renderDomainSuspendPreview(rawText) {
    const container = document.getElementById('domainSuspendPreview');
    if (!container) return;

    const map = gsStorage.parseDomainSuspendTimes(rawText);
    const entries = Object.entries(map);

    if (entries.length === 0) {
      container.innerHTML = '<em class="ds-preview-empty">Keine Regeln eingetragen.</em>';
      return;
    }

    // Build a small table using CSS classes instead of inline styles
    let html = '<table class="ds-preview-table">';
    html += '<thead><tr><th>Domain</th><th>Zeit</th></tr></thead><tbody>';
    for (const [domain, minutes] of entries) {
      const label = minutes <= 0 ? '⛔ Nie' : formatMinutes(minutes);
      html += `<tr>
        <td>${escapeHtml(domain)}</td>
        <td>${label}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function formatMinutes(minutes) {
    const m = parseFloat(minutes);
    if (m < 1) return Math.round(m * 60) + ' Sek.';
    if (m < 60) return m + ' Min.';
    if (m < 1440) return (m / 60) + ' Std.';
    return (m / 1440) + ' Tag(e)';
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  // ============================================================

  function handleChange(element) {
    return async() => {
      const pref = elementPrefMap[element.id];

      if (pref === gsStorage.SCREEN_CAPTURE) {
        setForceScreenCaptureVisibility(getOptionValue(element) !== '0');
      } else if (pref === gsStorage.SUSPEND_TIME) {
        const interval = getOptionValue(element);
        setAutoSuspendOptionsVisibility(interval > 0);
      } else if (pref === gsStorage.SYNC_SETTINGS) {
        if (getOptionValue(element)) {
          setSyncNoteVisibility(false);
        }
      } else if (pref === gsStorage.THEME) {
        gsUtils.setPageTheme(window, getOptionValue(element));
      } else if (pref === gsStorage.DOMAIN_SUSPEND_TIMES) {
        // Live preview while typing
        renderDomainSuspendPreview(getOptionValue(element));
      }

      var [oldValue, newValue] = await saveChange(element);
      if (oldValue !== newValue) {
        var prefKey = elementPrefMap[element.id];
        gsUtils.performPostSaveUpdates(
          [prefKey],
          { [prefKey]: oldValue },
          { [prefKey]: newValue },
        );
      }
    };
  }

async function saveChange(element) {
    const pref = elementPrefMap[element.id];
    let newValue = getOptionValue(element);
    const oldValue = await gsStorage.getOption(pref);

    if (pref === gsStorage.WHITELIST) {
      newValue = gsUtils.cleanupWhitelist(newValue);
    }

    if (oldValue === newValue) {
      return [oldValue, newValue]; // Frühes Return, wenn nichts zu speichern ist
    }

    await gsStorage.setOptionAndSync(elementPrefMap[element.id], newValue);
    return [oldValue, newValue];
  }

  gsUtils.documentReadyAndLocalisedAsPromised(window).then(function() {
    initSettings();

    var optionEls = document.getElementsByClassName('option'),
      element,
      i;

    for (i = 0; i < optionEls.length; i++) {
      element = optionEls[i];
      if (element.tagName === 'TEXTAREA') {
        element.addEventListener(
          'input',
          gsUtils.debounce(handleChange(element), 200),
          false,
        );
      } else {
        element.onchange = handleChange(element);
      }
    }

    document.getElementById('testWhitelistBtn').onclick = async (event) => {
      event.preventDefault();
      const tabs      = await gsChrome.tabsQuery();
      const tabUrls   = [];
      for (const tab of tabs) {
        const url     = gsUtils.isSuspendedTab(tab) ? gsUtils.getOriginalUrl(tab.url) : tab.url;
        if (!(gsUtils.isSpecialTab(tab)) && (await gsUtils.checkWhiteList(url))) {
          const str   = url.length > 55 ? url.substr(0, 52) + '...' : url;
          tabUrls.push(str);
        }
      }

      if (tabUrls.length === 0) {
        alert(chrome.i18n.getMessage('js_options_whitelist_no_matches'));
        return;
      }

      const firstUrls = tabUrls.splice(0, 22);
      let alertString = `${chrome.i18n.getMessage('js_options_whitelist_matches_heading')}\n${firstUrls.join('\n')}`;

      if (tabUrls.length > 0) {
        alertString += `\n${chrome.i18n.getMessage('js_options_whitelist_matches_overflow_prefix')} ${tabUrls.length} ${chrome.i18n.getMessage('js_options_whitelist_matches_overflow_suffix')}`;
      }
      alert(alertString);
    };

    if (chrome.extension.inIncognitoContext) {
      Array.prototype.forEach.call(
        document.getElementsByClassName('noIncognito'),
        function(el) {
          el.style.display = 'none';
        },
      );
      window.alert(chrome.i18n.getMessage('js_options_incognito_warning'));
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'initSettings') {
      initSettings();
      sendResponse({ success: true });
    }
    return true;
  });

})();
