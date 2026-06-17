// @ts-check
import  { gsIndexedDb }           from './gsIndexedDb.js';
import  { gsStorage }             from './gsStorage.js';
import  { gsUtils }               from './gsUtils.js';

export const gsFavicon = (() => {

  /**
   * @typedef { {
   * favIconUrl          : string,
   * isDark              : boolean,
   * normalisedDataUrl   : string,
   * transparentDataUrl  : string,
   * } } FavIconMeta
   */

  /** @type { FavIconMeta } */
  const FALLBACK_CHROME_FAVICON_META = {
    favIconUrl          : 'chrome://favicon/size/16@2x/fallbackChromeFaviconMeta',
    isDark              : true,
    normalisedDataUrl   : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVQ4T2NkoBAwIuuPior6j8O8xmXLljVgk8MwYNmyZdgMfcjAwLAAmyFEGfDv3z9FJiamA9gMIcoAkKsiIiIUsBlClAHofkf2JkED0DWDAnrUgOEfBsRkTpzpgBjN6GoA24V1Efr1zoAAAAAASUVORK5CYII=',
    transparentDataUrl  : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVQ4T2NkoBAwIuuPioqqx2YeExPTwSVLlhzAJodhwLJlyxrRDWVkZPzIyMh4AZshRBnAxsY28ffv3wnYDCHKAJCrEhISBLAZQpQB6H5H9iZBA9A1gwJ61IDhHwbEZE6c6YAYzehqAAmQeBHM42eMAAAAAElFTkSuQmCC',
  };

  /** @type { Record<string, string> } */
  let _defaultFaviconFingerprintById  = {};
  let _defaultChromeFaviconMeta       = FALLBACK_CHROME_FAVICON_META;

  async function getFaviconDefaults() {
    _defaultFaviconFingerprintById = (await gsStorage.getStorageJSON('session', gsStorage.DEFAULT_FAVICON_FINGERPRINTS)) ?? {};
    if (Object.keys(_defaultFaviconFingerprintById).length) return;

    const defaultIconUrls = [
      getChromeFavIconUrl('http://chromeDefaultFavicon'),
      getChromeFavIconUrl('chromeDefaultFavicon'),
      chrome.runtime.getURL('img/ic_suspendy_16x16.png'),
      chrome.runtime.getURL('img/chromeDefaultFavicon.png'),
    ];

    const faviconPromises = [];
    for (let i = 0; i < defaultIconUrls.length; i += 1) {
      const iconUrl = defaultIconUrls[i];
      faviconPromises.push(
        (new Promise(async (resolve) => {
          const faviconMeta = await addDefaultFaviconMeta(iconUrl);
          if (i === 0) {
            _defaultChromeFaviconMeta = faviconMeta || FALLBACK_CHROME_FAVICON_META;
          }
          resolve();
        }))
      );
    }
    await Promise.all(faviconPromises);
    await gsStorage.saveStorage('session', gsStorage.DEFAULT_FAVICON_FINGERPRINTS, _defaultFaviconFingerprintById);
  }

  async function addDefaultFaviconMeta(url) {
    let faviconMeta;
    try {
      faviconMeta = await gsUtils.executeWithRetries(buildFaviconMeta, [url], 4, 0);
      const url2  = `${url}Transparent`;
      _defaultFaviconFingerprintById[url]   = await createImageFingerprint(faviconMeta.normalisedDataUrl);
      _defaultFaviconFingerprintById[url2]  = await createImageFingerprint(faviconMeta.transparentDataUrl);
      return faviconMeta;
    }
    catch (error) {
      // ignore errors for defaults
    }
  }

  function getChromeFavIconUrl(url) {
    const icon_url = new URL(chrome.runtime.getURL('/_favicon/'));
    icon_url.searchParams.set('pageUrl', url);
    icon_url.searchParams.set('size', '32');
    return icon_url.toString();
  }
  
  // --- NEUE PRÜFFUNKTION ---
  // Überprüft, ob ein übergebenes Custom-Icon wirklich funktioniert oder blockiert wird.
  async function resolveValidTabIcon(favIconUrl) {
    if (!favIconUrl || favIconUrl.startsWith('blob:') || favIconUrl === chrome.runtime.getURL('img/ic_suspendy_16x16.png')) {
      return null;
    }

    const customMeta = await buildFaviconMetaFromTab(favIconUrl);
    if (!customMeta) return null;

    // Wenn dein Script direkt einen Base64 data: String injiziert, ist es absolut sicher.
    if (favIconUrl.startsWith('data:')) {
      return customMeta;
    }

    // Wenn das Icon eine URL ist und das Canvas es erfolgreich verarbeiten konnte (kein CORS Block),
    // ändert sich die interne URL in einen Base64-String. 
    // Ist die URL immer noch gleich, wurde das Bild blockiert -> Fehler!
    if (customMeta.normalisedDataUrl !== favIconUrl) {
      return customMeta;
    }

    return null; // Das Icon wurde blockiert. Werfe es weg!
  }

async function getFaviconMetaForUrl(url, tabFavIconUrl, fRecursion = false) {
    
    // 1. Prüfe, ob das live injizierte Tab-Icon gültig ist (für Userscripts)
    if (tabFavIconUrl) {
      const validMeta = await resolveValidTabIcon(tabFavIconUrl);
      if (validMeta) return validMeta;
    }

    // 2. Regulären Cache prüfen
    let faviconMeta = await getFaviconMetaFromCache(url);
    if (faviconMeta) return faviconMeta;

    // 3. Chromium API als robuster Standard für blockierte Seiten (Cloudflare etc.)
    faviconMeta = await buildFaviconMetaFromChrome(url);
    if (faviconMeta) {
      await saveFaviconMetaToCache(url, faviconMeta);
      return faviconMeta;
    }

    // 4. Rekursion auf Host-URL
    const fullUrl = new URL(url).toString();
    const hostUrl = gsUtils.getRootUrlNew(fullUrl);
    if (!fRecursion && fullUrl != hostUrl) {
      faviconMeta = await getFaviconMetaForUrl(hostUrl, tabFavIconUrl, true);
      if (faviconMeta) {
        await saveFaviconMetaToCache(url, faviconMeta);
        return faviconMeta;
      }
    }
  }

async function getFaviconMeta(tab) {
    let originalUrl = tab.url ?? '';
    const tabFavIconUrl = tab.favIconUrl ?? '';

    if (gsUtils.isFileTab(tab)) {
      return _defaultChromeFaviconMeta;
    }

    if (gsUtils.isSuspendedTab(tab)) {
      originalUrl = gsUtils.getOriginalUrl(tab.url);
      
      try {
        const suspendedInfo = await gsIndexedDb.fetchTabInfo(originalUrl);
        
        // --- HIER WAR DER FEHLER ---
        // Wir haben das Datenbank-Icon blind vertraut. Jetzt prüfen wir es erst!
        if (suspendedInfo && suspendedInfo.favIconUrl) {
          const validDbMeta = await resolveValidTabIcon(suspendedInfo.favIconUrl);
          if (validDbMeta) {
            return validDbMeta;
          }
        }
      } catch (e) {
        gsUtils.warning('gsFavicon', 'Failed to fetch custom favicon from DB', e);
      }
    }

    const faviconMeta = await getFaviconMetaForUrl(originalUrl, tabFavIconUrl);
    if (faviconMeta) {
      return faviconMeta;
    }

    // LÖSUNG C: GOOGLE S2 FALLBACK
    try {
      const urlObj = new URL(originalUrl);
      if (urlObj.protocol.startsWith('http')) {
        const googleFallbackUrl = `https://www.google.com/s2/favicons?sz=32&domain=${urlObj.hostname}`;
        return {
          favIconUrl: googleFallbackUrl,
          isDark: false,
          normalisedDataUrl: googleFallbackUrl,
          transparentDataUrl: googleFallbackUrl,
        };
      }
    } catch (e) { }

    return _defaultChromeFaviconMeta;
  }

  async function buildFaviconMetaFromChrome(url) {
    const chromeFavIconUrl = getChromeFavIconUrl(url);
    try {
      const faviconMeta = await buildFaviconMeta(chromeFavIconUrl);
      if (await isFaviconMetaValid(faviconMeta)) return faviconMeta;
    } catch (error) {}
  }

  async function buildFaviconMetaFromTab(favIconUrl) {
    if (favIconUrl && !favIconUrl.startsWith('blob:') && favIconUrl !== chrome.runtime.getURL('img/ic_suspendy_16x16.png')) {
      try {
        const faviconMeta = await buildFaviconMeta(favIconUrl);
        if (faviconMeta) return faviconMeta;
      } catch (error) {}
    }
  }

  async function getFaviconMetaFromCache(url) {
    const fullUrl   = gsUtils.getRootUrl(url, true, false);
    let faviconMeta = await gsIndexedDb.fetchFaviconMeta(fullUrl);
    if (!faviconMeta) {
      const rootUrl = gsUtils.getRootUrl(url, false, false);
      faviconMeta   = await gsIndexedDb.fetchFaviconMeta(rootUrl);
    }
    if (await isFaviconMetaValid(faviconMeta)) return faviconMeta;
  }

  async function saveFaviconMetaToCache(url, faviconMeta) {
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    const rootUrl = gsUtils.getRootUrl(url, false, false);
    await gsIndexedDb.addFaviconMeta(fullUrl, Object.assign({}, faviconMeta));
    await gsIndexedDb.addFaviconMeta(rootUrl, Object.assign({}, faviconMeta));
  }

  async function isFaviconMetaValid(faviconMeta) {
    if (!faviconMeta || faviconMeta.normalisedDataUrl === 'data:,' ) return false;
    
    if (!Object.keys(_defaultFaviconFingerprintById).length) {
      await getFaviconDefaults();
    }
    const normalisedFingerprint = await createImageFingerprint(faviconMeta.normalisedDataUrl);
    
    for (const id of Object.keys(_defaultFaviconFingerprintById)) {
      if (normalisedFingerprint === _defaultFaviconFingerprintById[id]) {
        return false;
      }
    }
    return true;
  }

  function createImageFingerprint(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = async () => {
        const canvas  = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
          canvas.width = 16; canvas.height = 16;
          context.drawImage(img, 0, 0, 16, 16);
          const fingerprintDataUrl = canvas.toDataURL('image/png');
          resolve(fingerprintDataUrl);
        } else {
          resolve('error'); // fail safe
        }
      };
      img.onerror = () => resolve('error');
      img.src = dataUrl;
    });
  }

  // --- HIER IST DER WICHTIGE FIX ---
  function buildFaviconMeta(url) {
    const timeout = 500; 

    return new Promise((resolve, reject) => {
      const img = new Image();
      
      // FIX: Chrome-interne URLs schlagen mit 'Anonymous' wegen fehlender CORS-Header fehl!
      // Wenn das Bild von unserer Extension (/_favicon/) kommt, dürfen wir KEIN crossOrigin anfordern.
      if (!url.startsWith('chrome-extension://') && !url.startsWith('chrome://')) {
        img.crossOrigin = 'Anonymous';
      }
      
      let isSettled = false;

      // Hilfsfunktion: Wenn Canvas fehlschlägt, nimm einfach die Original-URL!
      const fallbackResolve = () => {
        if (isSettled) return;
        isSettled = true;
        
        if (url.startsWith('blob:')) {
          resolve(null);
          return;
        }
        
        resolve({
          favIconUrl: url,
          isDark: false,
          normalisedDataUrl: url,
          transparentDataUrl: url,
        });
      };

      img.onload = () => {
        if (isSettled) return;
        
        try {
          const canvas  = document.createElement('canvas');
          canvas.width  = img.width || 16;
          canvas.height = img.height || 16;
          const context = canvas.getContext('2d');

          if (!context) throw new Error('No context');

          context.drawImage(img, 0, 0);

          let imageData;
          try {
            imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          } catch (e) {
            // Security Error (CORS) -> Sofort Fallback nutzen!
            fallbackResolve();
            return;
          }

          const origDataArray = imageData.data;
          const normalisedDataArray = new Uint8ClampedArray(origDataArray);
          const transparentDataArray = new Uint8ClampedArray(origDataArray);
          
          let maxAlpha = 0;
          for (let x = 0; x < origDataArray.length; x += 4) {
             maxAlpha = Math.max(origDataArray[x+3], maxAlpha);
          }

          if (maxAlpha === 0) {
            fallbackResolve();
            return;
          }
          
          const normaliserMultiple = 1 / (maxAlpha / 255);
          for (let x = 0; x < normalisedDataArray.length; x += 4) {
            let a = normalisedDataArray[x + 3];
            normalisedDataArray[x + 3] = parseInt(String(a * normaliserMultiple), 10);
            transparentDataArray[x + 3] = parseInt(String(a * 0.5), 10);
          }

          imageData.data.set(normalisedDataArray);
          context.putImageData(imageData, 0, 0);
          const normalisedDataUrl = canvas.toDataURL('image/png');

          imageData.data.set(transparentDataArray);
          context.putImageData(imageData, 0, 0);
          const transparentDataUrl = canvas.toDataURL('image/png');

          isSettled = true;
          resolve({
            favIconUrl: url,
            isDark: false,
            normalisedDataUrl,
            transparentDataUrl,
          });

        } catch (err) {
          fallbackResolve();
        }
      };

      img.onerror = () => {
        fallbackResolve();
      };

      img.src = url;

      setTimeout(() => {
        fallbackResolve();
      }, timeout);
    });
  }

return {
    getFaviconMeta,
    getChromeFavIconUrl,
    isFaviconMetaValid,
    buildFaviconMeta,
  };
})();