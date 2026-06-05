// ==UserScript==
// @name         Rule34 Favorites Search
// @version      1.7
// @description  Adds a search bar to the Favorites page
// @author       Librake
// @match        https://rule34.xxx/index.php?page=post&s=list*
// @match        https://rule34.xxx/index.php?page=post&s=view&id=*
// @match        https://rule34.xxx/index.php?page=favorites&s=view&id=*
// @icon         https://i.imgur.com/CgJD0Mx.png
// @grant        none
// @license      MIT
// ==/UserScript==
//CHANGELOG 1.6 -> 1.7
// Cache/Scan robuster: exakter Blacklist-Abgleich, deduplizierte Ergebnisse, stabilerer Retry-Backoff
// UI/Rendering optimiert: weniger MutationObserver/Eventlistener, sichereres DOM-Rendering statt innerHTML
// Script-Metadaten aufgeräumt: ungenutzte GM-Grants entfernt, LZString nur noch einmal lokal genutzt
//CHANGELOG 1.5 -> 1.6
// "unötige" featuers enternt wie z.B isMobil, Custom Icons, tooltips, autocomplete + search input für tags
//CHANGELOG 1.4 -> 1.5
// searchAllPages + searchAllPages weniger timeout / rate-limit durch flüssigares favorites fetchen,
// FETCH_DELAY_MS / PENDING_POLL_MS / MAX_IN_FLIGHT

(function () {
    'use strict';

    var inlineLZString = function(){function o(o,r){if(!t[o]){t[o]={};for(var n=0;n<o.length;n++)t[o][o.charAt(n)]=n}return t[o][r]}var r=String.fromCharCode,n="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",e="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$",t={},i={compressToBase64:function(o){if(null==o)return"";var r=i._compress(o,6,function(o){return n.charAt(o)});switch(r.length%4){default:case 0:return r;case 1:return r+"===";case 2:return r+"==";case 3:return r+"="}},decompressFromBase64:function(r){return null==r?"":""==r?null:i._decompress(r.length,32,function(e){return o(n,r.charAt(e))})},compressToUTF16:function(o){return null==o?"":i._compress(o,15,function(o){return r(o+32)})+" "},decompressFromUTF16:function(o){return null==o?"":""==o?null:i._decompress(o.length,16384,function(r){return o.charCodeAt(r)-32})},compressToUint8Array:function(o){for(var r=i.compress(o),n=new Uint8Array(2*r.length),e=0,t=r.length;t>e;e++){var s=r.charCodeAt(e);n[2*e]=s>>>8,n[2*e+1]=s%256}return n},decompressFromUint8Array:function(o){if(null===o||void 0===o)return i.decompress(o);for(var n=new Array(o.length/2),e=0,t=n.length;t>e;e++)n[e]=256*o[2*e]+o[2*e+1];var s=[];return n.forEach(function(o){s.push(r(o))}),i.decompress(s.join(""))},compressToEncodedURIComponent:function(o){return null==o?"":i._compress(o,6,function(o){return e.charAt(o)})},decompressFromEncodedURIComponent:function(r){return null==r?"":""==r?null:(r=r.replace(/ /g,"+"),i._decompress(r.length,32,function(n){return o(e,r.charAt(n))}))},compress:function(o){return i._compress(o,16,function(o){return r(o)})},_compress:function(o,r,n){if(null==o)return"";var e,t,i,s={},p={},u="",c="",a="",l=2,f=3,h=2,d=[],m=0,v=0;for(i=0;i<o.length;i+=1)if(u=o.charAt(i),Object.prototype.hasOwnProperty.call(s,u)||(s[u]=f++,p[u]=!0),c=a+u,Object.prototype.hasOwnProperty.call(s,c))a=c;else{if(Object.prototype.hasOwnProperty.call(p,a)){if(a.charCodeAt(0)<256){for(e=0;h>e;e++)m<<=1,v==r-1?(v=0,d.push(n(m)),m=0):v++;for(t=a.charCodeAt(0),e=0;8>e;e++)m=m<<1|1&t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}else{for(t=1,e=0;h>e;e++)m=m<<1|t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t=0;for(t=a.charCodeAt(0),e=0;16>e;e++)m=m<<1|1&t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}l--,0==l&&(l=Math.pow(2,h),h++),delete p[a]}else for(t=s[a],e=0;h>e;e++)m=m<<1|1&t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t>>=1;l--,0==l&&(l=Math.pow(2,h),h++),s[c]=f++,a=String(u)}if(""!==a){if(Object.prototype.hasOwnProperty.call(p,a)){if(a.charCodeAt(0)<256){for(e=0;h>e;e++)m<<=1,v==r-1?(v=0,d.push(n(m)),m=0):v++;for(t=a.charCodeAt(0),e=0;8>e;e++)m=m<<1|1&t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}else{for(t=1,e=0;h>e;e++)m=m<<1|t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t=0;for(t=a.charCodeAt(0),e=0;16>e;e++)m=m<<1|1&t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}l--,0==l&&(l=Math.pow(2,h),h++),delete p[a]}else for(t=s[a],e=0;h>e;e++)m=m<<1|1&t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t>>=1;l--,0==l&&(l=Math.pow(2,h),h++)}for(t=2,e=0;h>e;e++)m=m<<1|1&t,v==r-1?(v=0,d.push(n(m)),m=0):v++,t>>=1;for(;;){if(m<<=1,v==r-1){d.push(n(m));break}v++}return d.join("")},decompress:function(o){return null==o?"":""==o?null:i._decompress(o.length,32768,function(r){return o.charCodeAt(r)})},_decompress:function(o,n,e){var t,i,s,p,u,c,a,l,f=[],h=4,d=4,m=3,v="",w=[],A={val:e(0),position:n,index:1};for(i=0;3>i;i+=1)f[i]=i;for(p=0,c=Math.pow(2,2),a=1;a!=c;)u=A.val&A.position,A.position>>=1,0==A.position&&(A.position=n,A.val=e(A.index++)),p|=(u>0?1:0)*a,a<<=1;switch(t=p){case 0:for(p=0,c=Math.pow(2,8),a=1;a!=c;)u=A.val&A.position,A.position>>=1,0==A.position&&(A.position=n,A.val=e(A.index++)),p|=(u>0?1:0)*a,a<<=1;l=r(p);break;case 1:for(p=0,c=Math.pow(2,16),a=1;a!=c;)u=A.val&A.position,A.position>>=1,0==A.position&&(A.position=n,A.val=e(A.index++)),p|=(u>0?1:0)*a,a<<=1;l=r(p);break;case 2:return""}for(f[3]=l,s=l,w.push(l);;){if(A.index>o)return"";for(p=0,c=Math.pow(2,m),a=1;a!=c;)u=A.val&A.position,A.position>>=1,0==A.position&&(A.position=n,A.val=e(A.index++)),p|=(u>0?1:0)*a,a<<=1;switch(l=p){case 0:for(p=0,c=Math.pow(2,8),a=1;a!=c;)u=A.val&A.position,A.position>>=1,0==A.position&&(A.position=n,A.val=e(A.index++)),p|=(u>0?1:0)*a,a<<=1;f[d++]=r(p),l=d-1,h--;break;case 1:for(p=0,c=Math.pow(2,16),a=1;a!=c;)u=A.val&A.position,A.position>>=1,0==A.position&&(A.position=n,A.val=e(A.index++)),p|=(u>0?1:0)*a,a<<=1;f[d++]=r(p),l=d-1,h--;break;case 2:return w.join("")}if(0==h&&(h=Math.pow(2,m),m++),f[l])v=f[l];else{if(l!==d)return null;v=s+s.charAt(0)}w.push(v),f[d++]=s+v.charAt(0),h--,s=v,0==h&&(h=Math.pow(2,m),m++)}}};return i}();

    var localLZString = inlineLZString;

    // ── State ─────────────────────────────────────────────────────────────────
    let allImages        = [];
    let loadedImages     = [];
    let images;
    let results          = [];
    let allImageIds      = new Set();
    let resultIds        = new Set();
    let fromBack         = false;
    let needScan         = false;
    let fullScan         = false;
    let actualFavCount;
    let prevFavCount;
    let appendLoadedSave = false;
    let prevUserId;
    let lastImageId;
    let textColor;
    let darkMode         = false;
    let userId;
    let useBlacklist     = true;   // dauerhaft aktiv
    let borderFavs       = true;

    let currentResults   = [];
    let currentPage      = 1;
    let imagesPerPage    = 50;
    let modalEscListenerBound = false;
    let activeModalResizeHandler = null;
    const CACHE_VERSION = 2;

    // ── PageType ──────────────────────────────────────────────────────────────
    const PageType = {
        FAVORITE_VIEW: 'FAVORITE_VIEW',
        POST_LIST:     'POST_LIST',
        POST_VIEW:     'POST_VIEW',
        UNKNOWN:       'UNKNOWN',
    };

    function getPageType() {
        const url = window.location.href;
        if (url.includes('page=favorites&s=view&id=')) return PageType.FAVORITE_VIEW;
        if (url.includes('page=post&s=list'))          return PageType.POST_LIST;
        if (url.includes('page=post&s=view'))          return PageType.POST_VIEW;
        return PageType.UNKNOWN;
    }
    const pageType = getPageType();

    // ── Helpers ───────────────────────────────────────────────────────────────
    function getBgColor() {
        return window.getComputedStyle(document.querySelector('body')).backgroundColor;
    }

    function isDarkMode() {
        const links = document.querySelectorAll('link[rel="stylesheet"][type="text/css"][media="screen"]');
        for (let i = 0; i < links.length; i++) {
            if (links[i].getAttribute('href')?.includes('dark.css')) return true;
        }
        return false;
    }

    function getIdFromUrl() {
        const url   = window.location.href;
        const idx   = url.indexOf('id=');
        if (idx === -1) return null;
        const start = idx + 3;
        const end   = url.indexOf('&', start);
        return url.substring(start, end === -1 ? url.length : end);
    }

    function getThumbImgId(img) {
        return img.src.split('?')[1];
    }

    function getCookieValue(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    function cropCurrentPage(arr, page, perPage) {
        const start = (page - 1) * perPage;
        return arr.slice(start, start + perPage);
    }

    function handleModalEscape(event) {
        if (event.key === 'Escape' && document.getElementById('resultContainer')) {
            localStorage.setItem('fromBack', JSON.stringify(true));
            location.reload();
        }
    }

    // ── LocalStorage ──────────────────────────────────────────────────────────
    function loadSavedData() {
        const savedborderFavs = localStorage.getItem('borderFavs');
        borderFavs = savedborderFavs ? JSON.parse(savedborderFavs) : true;

        const savedFromBack = localStorage.getItem('fromBack');
        fromBack = savedFromBack ? JSON.parse(savedFromBack) : false;
        localStorage.removeItem('fromBack');

        const savedPrevFavCount = localStorage.getItem('prevFavCount');
        prevFavCount = (savedPrevFavCount && savedPrevFavCount !== 'undefined')
            ? JSON.parse(savedPrevFavCount) : 0;

        prevUserId = loadSavedUserId();
    }

    function loadSavedUserId() {
        const saved = localStorage.getItem('userId');
        return (saved && saved !== 'undefined') ? JSON.parse(saved) : null;
    }

    function loadAllImagesFromLocalStorage(callback) {
        try {
            const storedData = localStorage.getItem('allImages');
            if (!storedData) { callback([]); return; }
            const decompressed = localLZString.decompressFromUTF16(storedData);
            const parsed = decompressed ? JSON.parse(decompressed) : [];
            callback(Array.isArray(parsed) ? parsed : (parsed.images || []));
        } catch (e) {
            callback([]);
        }
    }

    function saveAllImagesToLocalStorage() {
        const data = allImages.map(img => ({
            src:   img.getAttribute('src'),
            title: img.getAttribute('title'),
            link:  `index.php?page=post&s=view&id=${getThumbImgId(img)}`,
            id:    getThumbImgId(img),
            score: img.score
        }));

        if (appendLoadedSave) {
            data.push(...loadedImages.map(img => ({
                src:   img.src,
                title: img.title,
                link:  img.link,
                id:    img.id,
                score: img.score
            })));
        }

        const payload = {
            version: CACHE_VERSION,
            userId: userId,
            updatedAt: Date.now(),
            images: data
        };

        try {
            localStorage.setItem('allImages', localLZString.compressToUTF16(JSON.stringify(payload)));
        } catch (e) {
            console.error('Storage limit exceeded:', e);
        }
    }

    // ── Queues ────────────────────────────────────────────────────────────────
    function getRemovalQueue()    { return JSON.parse(localStorage.getItem('removalQueue')    || '[]'); }
    function clearRemovalQueue()  { localStorage.removeItem('removalQueue'); }
    function addToRemovalQueue(id) {
        const q = getRemovalQueue(); q.push(id);
        localStorage.setItem('removalQueue', JSON.stringify(q));
    }

    function getAdditionalQueue()   { return JSON.parse(localStorage.getItem('additionalQueue') || '[]'); }
    function clearAdditionalQueue() { localStorage.removeItem('additionalQueue'); }
    function addToAdditionalQueue(id) {
        const q = getAdditionalQueue();
        if (!q.includes(id)) { q.push(id); localStorage.setItem('additionalQueue', JSON.stringify(q)); }
    }
    function removeFromAdditionalQueue(id) {
        const q = getAdditionalQueue();
        const idx = q.indexOf(id);
        if (idx !== -1) { q.splice(idx, 1); localStorage.setItem('additionalQueue', JSON.stringify(q)); }
    }

    // ── Network ───────────────────────────────────────────────────────────────
    async function getFavoritesCount(uid) {
        try {
            const resp = await fetch(`https://rule34.xxx/index.php?page=account&s=profile&id=${uid}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
            const row = Array.from(doc.querySelectorAll('tr'))
                .find(r => r.querySelector('td strong')?.textContent.trim() === 'Favorites');
            if (!row) throw new Error('Favorites row not found');
            const txt = row.querySelector('td a')?.textContent.trim();
            return txt ? parseInt(txt, 10) : null;
        } catch (e) {
            console.error('Error fetching favorites count:', e);
            return null;
        }
    }

    const MAX_RETRIES       = 5;
    const BACKOFF_BASE_MS   = 2000;
    const MAX_BACKOFF_MS    = 30000;

    function getRetryDelay(retryCount) {
        const exponential = BACKOFF_BASE_MS * Math.pow(2, retryCount);
        const jitter = Math.floor(Math.random() * 750);
        return Math.min(exponential + jitter, MAX_BACKOFF_MS);
    }

    async function fetchFavoritesPage(page, retryCount = 0) {
        const url = `https://rule34.xxx/index.php?page=favorites&s=view&id=${userId}&pid=${page * 50}`;
        try {
            const response = await fetch(url);
            if (response.status === 429 || response.status === 503) {
                if (retryCount >= MAX_RETRIES) { console.error(`Page ${page}: max retries`); return null; }
                await new Promise(r => setTimeout(r, getRetryDelay(retryCount)));
                return fetchFavoritesPage(page, retryCount + 1);
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return new DOMParser().parseFromString(await response.text(), 'text/html');
        } catch (err) {
            if (retryCount < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, getRetryDelay(retryCount)));
                return fetchFavoritesPage(page, retryCount + 1);
            }
            console.error(`Page ${page}: failed after ${MAX_RETRIES} retries.`, err);
            return null;
        }
    }

    // ── Extraction ────────────────────────────────────────────────────────────
    async function extractImagesAndTags(doc, loadedImgs) {
        const postScores = new Map();

        if (loadedImgs) {
            images = loadedImgs;
        } else {
            doc.querySelectorAll('script').forEach(script => {
                if (!script.textContent.includes('score:')) return;
                const re = /posts\[(\d+)]\s*=\s*{[\s\S]*?score:\s*['"](\d+)['"]/g;
                let m;
                while ((m = re.exec(script.textContent)) !== null) postScores.set(m[1], m[2]);
            });
            images = doc.querySelectorAll('.thumb img[src]');
        }

        // Blacklist (dauerhaft aktiv)
        const negativeTags = new Set();
        if (useBlacklist) {
            const bl = getCookieValue('tag_blacklist');
            if (bl) {
                decodeURIComponent(bl)
                    .split(/\s+/)
                    .filter(Boolean)
                    .forEach(t => negativeTags.add(t));
            }
        }

        images.forEach(image => {
            if (!loadedImgs) {
                const imgId  = getThumbImgId(image);
                image.score  = postScores.get(imgId) || null;
                if (!allImageIds.has(imgId)) {
                    allImageIds.add(imgId);
                    allImages.push(image);
                }
            }

            const tags = image.title || '';

            // Blacklist-Filter
            const tagSet = new Set(tags.trim().split(/\s+/).filter(Boolean));
            for (const ntag of negativeTags) {
                if (tagSet.has(ntag)) return;
            }

            if (loadedImgs) {
                const post = {
                    link:  image.link,
                    src:   image.src,
                    id:    image.link.split('id=')[1],
                    score: image.score,
                    video: (image.title || '').trim().split(' ').includes('video')
                };
                if (!resultIds.has(post.id)) {
                    resultIds.add(post.id);
                    results.push(post);
                }
            } else {
                const imageId = getThumbImgId(image);
                const post = {
                    link:  `index.php?page=post&s=view&id=${imageId}`,
                    src:   image.src,
                    id:    imageId,
                    score: image.score,
                    video: tags.trim().split(' ').includes('video')
                };
                if (!resultIds.has(post.id)) {
                    resultIds.add(post.id);
                    results.push(post);
                }
            }
        });

        if (!loadedImgs && images.length) {
            lastImageId = getThumbImgId(images[images.length - 1]);
        }
    }

    // ── Scan Entry Points ─────────────────────────────────────────────────────
    function scan() {
        results = [];
        resultIds = new Set();
        currentResults = [];
        if (needScan) {
            if (fullScan) {
                allImages = [];
                allImageIds = new Set();
                appendLoadedSave = false;
            }
            fullScan ? searchAllPages() : searchNewPages();
        } else {
            loadAllPages();
        }
    }

    function loadAllPages() {
        results = [];
        resultIds = new Set();
        extractImagesAndTags(false, loadedImages);
        displayResultsInModal();
    }

    async function searchAllPages(startPage = 0) {
        if (startPage === 0) {
            allImages = [];
            allImageIds = new Set();
            appendLoadedSave = false;
        }
        const totalPages    = Math.ceil(actualFavCount / 50);
        const FETCH_DELAY   = 1000;
        const POLL_DELAY    = 200;
        const MAX_IN_FLIGHT = 5;

        const inFlight  = new Set();
        const failed    = [];
        let nextPage    = startPage;
        let allFetched  = false;
        let loadedCount = startPage;
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        async function fetchPage(page) {
            try {
                const doc = await fetchFavoritesPage(page);
                if (!doc) { inFlight.delete(page); return; }
                await extractImagesAndTags(doc);
                if (images && images.length > 0) loadedCount++;
                displayScanStatus(`scanning: ${loadedCount} / ${totalPages}  (full)`);
            } catch (err) {
                console.error(`Error on page ${page}:`, err);
                failed.push(page);
            } finally {
                inFlight.delete(page);
            }
        }

        while (!allFetched || inFlight.size > 0 || failed.length > 0) {
            if (inFlight.size < MAX_IN_FLIGHT) {
                let pageToFetch = null;
                if (failed.length > 0)         { pageToFetch = failed.shift(); }
                else if (nextPage < totalPages) { pageToFetch = nextPage++; if (nextPage >= totalPages) allFetched = true; }
                if (pageToFetch !== null) { inFlight.add(pageToFetch); fetchPage(pageToFetch); await sleep(FETCH_DELAY); continue; }
            }
            await sleep(POLL_DELAY);
        }

        displayResultsInModal();
    }

    async function searchNewPages() {
        allImages = [];
        results = [];
        allImageIds = new Set();
        resultIds = new Set();
        const totalPages    = Math.min(10, Math.ceil(actualFavCount / 50));
        const FETCH_DELAY   = 1000;
        const POLL_DELAY    = 200;
        const MAX_IN_FLIGHT = 5;

        const inFlight  = new Set();
        const failed    = [];
        let nextPage    = 0;
        let allFetched  = false;
        let loadedCount = 0;
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        async function fetchPage(page) {
            try {
                const doc = await fetchFavoritesPage(page);
                if (!doc) { inFlight.delete(page); return; }
                await extractImagesAndTags(doc);
                if (images && images.length > 0) loadedCount++;
                displayScanStatus(`scanning: ${loadedCount} / ${totalPages}`);
            } catch (err) {
                console.error(`Error on page ${page}:`, err);
                failed.push(page);
            } finally {
                inFlight.delete(page);
            }
        }

        while (!allFetched || inFlight.size > 0 || failed.length > 0) {
            if (inFlight.size < MAX_IN_FLIGHT) {
                let pageToFetch = null;
                if (failed.length > 0)         { pageToFetch = failed.shift(); }
                else if (nextPage < totalPages) { pageToFetch = nextPage++; if (nextPage >= totalPages) allFetched = true; }
                if (pageToFetch !== null) { inFlight.add(pageToFetch); fetchPage(pageToFetch); await sleep(FETCH_DELAY); continue; }
            }
            await sleep(POLL_DELAY);
        }

        const lastResultId   = lastImageId;
        const indexToDelete  = loadedImages.findIndex(item => item.link.split('id=')[1] === lastResultId);
        if (indexToDelete !== -1) {
            loadedImages.splice(0, indexToDelete + 1);
            extractImagesAndTags(false, loadedImages);
            appendLoadedSave = true;
            displayResultsInModal();
        } else {
            searchAllPages(10);
        }
    }

    // ── Status ────────────────────────────────────────────────────────────────
    function displayScanStatus(text) {
        const el = document.getElementById('progress');
        if (el) el.textContent = text;
    }

    // ── Header-UI ─────────────────────────────────────────────────────────────
    // Identisch zum Original: Score+Random Buttons, Search-Button und #progress
    // werden per header.insertBefore(inputContainer, navbar.nextSibling) eingebaut.
    function createHeaderUI() {
        const header = document.getElementById('header');
        const navbar = document.getElementById('navbar');
        if (!header || !navbar) return;

        const inputContainer = document.createElement('div');
        inputContainer.style.marginTop    = '-50px';
        inputContainer.style.marginLeft   = '0px';
        inputContainer.style.marginBottom = '-5px';

        // Score + Random (createSortButtonsInline)
        const sortContainer = document.createElement('div');
        sortContainer.style.display     = 'inline-block';
        sortContainer.style.marginRight = '10px';
        sortContainer.style.marginLeft  = '37%';
        sortContainer.style.position    = 'sticky';

        [{ label: 'Score', value: 'score' }, { label: 'Random', value: 'random' }].forEach(sort => {
            const btn = document.createElement('button');
            btn.textContent           = sort.label;
            btn.style.marginLeft      = '5px';
            btn.style.padding         = '5px 10px';
            btn.style.backgroundColor = '#808080';
            btn.style.color           = '#fff';
            btn.style.border          = '1px solid rgb(204, 204, 204)';
            btn.style.borderRadius    = '3px';
            btn.style.cursor          = 'pointer';
            btn.style.fontSize        = '30px';

            btn.addEventListener('click', () => {
                if (!results || results.length === 0) {
                    const compressed = localStorage.getItem('allImages');
                    if (compressed && localLZString) {
                        try {
                            const parsed = JSON.parse(localLZString.decompressFromUTF16(compressed)) || [];
                            results = Array.isArray(parsed) ? parsed : (parsed.images || []);
                            resultIds = new Set(results.map(result => result.id));
                        }
                        catch (e) { console.warn('Fehler beim Laden gespeicherter Favoriten', e); }
                    }
                    if (!results || results.length === 0) {
                        alert('Keine Ergebnisse. Bitte zuerst über Search-Button laden.');
                        return;
                    }
                }
                if (sort.value === 'score') {
                    results.sort((a, b) => (parseInt(b.score, 10) || 0) - (parseInt(a.score, 10) || 0));
                } else {
                    results.sort(() => 0.5 - Math.random());
                }
                renderResultsToGalleryChunked();
            });
            sortContainer.appendChild(btn);
        });

        // Search Button (createSearchButton)
        const searchBtn = document.createElement('button');
        searchBtn.textContent           = 'Search';
        searchBtn.style.color           = 'white';
        searchBtn.style.backgroundColor = '#e26c5e';
        searchBtn.style.marginRight     = '10px';
        searchBtn.style.padding         = '5px 10px';
        searchBtn.style.border          = '1px solid #ccc';
        searchBtn.style.borderRadius    = '3px';
        searchBtn.style.cursor          = 'pointer';
        searchBtn.style.fontSize        = '30px';
        searchBtn.style.marginLeft      = '-5px';
        searchBtn.style.position        = 'sticky';
        searchBtn.onmouseover = () => { searchBtn.style.backgroundColor = '#c45a4b'; };
        searchBtn.onmouseout  = () => { searchBtn.style.backgroundColor = '#e26c5e'; };
        searchBtn.onclick     = () => { scan(); };

        // #progress span
        const progress = document.createElement('span');
        progress.id               = 'progress';
        progress.style.marginLeft = '0px';
        progress.style.fontSize   = '25px';

        inputContainer.appendChild(sortContainer);
        inputContainer.appendChild(searchBtn);
        inputContainer.appendChild(progress);

        // In Header einfügen – identisch zum Original
        header.insertBefore(inputContainer, navbar.nextSibling);
    }

    // ── displayResultsInModal ─────────────────────────────────────────────────
    function displayResultsInModal(columnWidth = 250) {
        const bgColor = getBgColor();

        const savedImagesPerPage = localStorage.getItem('imagesPerPage') || 50;
        imagesPerPage = savedImagesPerPage === '5'
            ? actualFavCount
            : parseInt(savedImagesPerPage, 10);

        localStorage.setItem('prevFavCount', JSON.stringify(actualFavCount));
        localStorage.setItem('userId',       JSON.stringify(userId));

        if (needScan) {
            try { saveAllImagesToLocalStorage(); clearRemovalQueue(); clearAdditionalQueue(); }
            catch (e) {}
        }

        document.querySelector('#resultContainer')?.remove();

        let removeLabelsShown = false;

        const resultContainer = document.createElement('div');
        resultContainer.id                    = 'resultContainer';
        resultContainer.style.width           = '100%';
        resultContainer.style.height          = '100vh';
        resultContainer.style.backgroundColor = bgColor;
        resultContainer.style.color           = 'white';
        resultContainer.style.overflowY       = 'auto';
        resultContainer.style.zIndex          = '10000';
        resultContainer.style.padding         = '20px';
        resultContainer.style.boxSizing       = 'border-box';
        resultContainer.style.display         = 'flex';
        resultContainer.style.flexDirection   = 'column';

        const imagesContainer = document.createElement('div');
        imagesContainer.id                   = 'imagesContainer';
        imagesContainer.style.width          = '100%';
        imagesContainer.style.marginTop      = '10px';
        imagesContainer.style.display        = 'flex';
        imagesContainer.style.flexWrap       = 'wrap';
        imagesContainer.style.justifyContent = 'flex-start';
        imagesContainer.style.alignContent   = 'flex-start';
        imagesContainer.style.alignItems     = 'flex-start';

        const imageCount = document.createElement('div');
        let hiddenVideoNumber = 0;
        function updateImageCounter() {
            imageCount.textContent = `Images: ${results.length - hiddenVideoNumber}`;
        }

        // Buttons
        const defaultButtonColor        = '#DBA19D';
        const defaultButtonColorHovered = '#9E7471';
        const activeButtonColor         = '#e26c5e';
        const activeButtonColorHovered  = '#c45a4b';
        let selectedButton;

        function isButtonSelected(btn) { return selectedButton === btn; }
        function selectButton(btn) {
            if (isButtonSelected(btn)) return;
            resetButtonSelection();
            selectedButton = btn;
            btn.style.backgroundColor = activeButtonColorHovered;
        }
        function resetButtonSelection() {
            hiddenVideoNumber = 0;
            [randomizeButton, scoreButton, dateButton].forEach(b => {
                b.style.backgroundColor = defaultButtonColor;
            });
        }

        const headerContainer = document.createElement('div');
        headerContainer.style.width         = '100%';
        headerContainer.style.display       = 'flex';
        headerContainer.style.flexDirection = 'column';
        headerContainer.style.alignItems    = 'flex-start';

        imageCount.textContent        = `Images: ${results.length}`;
        imageCount.style.fontFamily   = 'Verdana, sans-serif';
        imageCount.style.fontSize     = '20px';
        imageCount.style.fontWeight   = 'bold';
        imageCount.style.color        = textColor;
        imageCount.style.textAlign    = 'left';
        imageCount.style.marginBottom = '10px';

        const controlsContainer = document.createElement('div');
        controlsContainer.style.width      = '100%';
        controlsContainer.style.display    = 'flex';
        controlsContainer.style.alignItems = 'center';

        // Toggle Remove Label
        const toggleRemoveLabelContainer = document.createElement('div');
        toggleRemoveLabelContainer.style.display    = 'flex';
        toggleRemoveLabelContainer.style.alignItems = 'center';

        const toggleRemoveLabelCheckbox = document.createElement('input');
        toggleRemoveLabelCheckbox.type              = 'checkbox';
        toggleRemoveLabelCheckbox.id                = 'toggleRemoveLabelCheckbox';
        toggleRemoveLabelCheckbox.style.marginRight = '10px';
        toggleRemoveLabelCheckbox.onchange = () => {
            removeLabelsShown = toggleRemoveLabelCheckbox.checked;
            document.querySelectorAll('.removeLabel').forEach(lbl => {
                lbl.style.display = removeLabelsShown ? 'inline' : 'none';
            });
            document.querySelectorAll('.resultItem').forEach(item => {
                item.style.height = removeLabelsShown ? '275px' : '250px';
            });
        };

        const toggleRemoveLabelText = document.createElement('label');
        toggleRemoveLabelText.htmlFor      = 'toggleRemoveLabelCheckbox';
        toggleRemoveLabelText.textContent  = 'Removing';
        toggleRemoveLabelText.style.color      = textColor;
        toggleRemoveLabelText.style.fontFamily = 'Verdana, sans-serif';
        toggleRemoveLabelText.style.fontSize   = '16px';
        toggleRemoveLabelText.style.fontWeight = 'bold';
        toggleRemoveLabelContainer.appendChild(toggleRemoveLabelCheckbox);
        toggleRemoveLabelContainer.appendChild(toggleRemoveLabelText);

        // Randomize
        const randomizeButton = document.createElement('button');
        randomizeButton.textContent           = 'Randomize';
        randomizeButton.style.backgroundColor = defaultButtonColor;
        randomizeButton.style.color           = 'white';
        randomizeButton.style.border          = 'none';
        randomizeButton.style.padding         = '5px 10px 3px 10px';
        randomizeButton.style.cursor          = 'pointer';
        randomizeButton.style.borderRadius    = '3px';
        randomizeButton.style.fontSize        = '18px';
        randomizeButton.style.marginLeft      = '50px';
        randomizeButton.onmouseover = () => {
            randomizeButton.style.backgroundColor = isButtonSelected(randomizeButton) ? activeButtonColorHovered : defaultButtonColorHovered;
        };
        randomizeButton.onmouseout = () => {
            randomizeButton.style.backgroundColor = isButtonSelected(randomizeButton) ? activeButtonColor : defaultButtonColor;
        };
        randomizeButton.onclick = () => {
            if (isButtonSelected(scoreButton)) { hiddenVideoNumber = 0; updateImageCounter(); }
            selectButton(randomizeButton);
            updateCurrentResults(results.slice().sort(() => 0.5 - Math.random()));
        };

        // Score
        const scoreButton = document.createElement('button');
        scoreButton.textContent           = 'Score';
        scoreButton.style.backgroundColor = defaultButtonColor;
        scoreButton.style.color           = 'white';
        scoreButton.style.border          = 'none';
        scoreButton.style.padding         = '5px 10px 3px 10px';
        scoreButton.style.cursor          = 'pointer';
        scoreButton.style.borderRadius    = '3px';
        scoreButton.style.fontSize        = '18px';
        scoreButton.style.marginLeft      = '20px';
        scoreButton.onmouseover = () => {
            scoreButton.style.backgroundColor = isButtonSelected(scoreButton) ? activeButtonColorHovered : defaultButtonColorHovered;
        };
        scoreButton.onmouseout = () => {
            scoreButton.style.backgroundColor = isButtonSelected(scoreButton) ? activeButtonColor : defaultButtonColor;
        };
        let isNoVid = false;
        scoreButton.onclick = () => {
            if (isButtonSelected(scoreButton)) {
                isNoVid = !isNoVid;
                scoreButton.textContent = isNoVid ? 'Score no video' : 'Score';
            } else {
                selectButton(scoreButton);
            }
            let sorted;
            if (isNoVid) {
                sorted = results.filter(r => !r.video);
                hiddenVideoNumber = results.length - sorted.length;
                sorted = sorted.sort((a, b) => (parseInt(b.score, 10) || 0) - (parseInt(a.score, 10) || 0));
            } else {
                sorted = results.slice().sort((a, b) => (parseInt(b.score, 10) || 0) - (parseInt(a.score, 10) || 0));
                hiddenVideoNumber = 0;
            }
            updateImageCounter();
            updateCurrentResults(sorted);
        };

        // Date/New
        const dateButton = document.createElement('button');
        dateButton.textContent           = 'New';
        dateButton.style.backgroundColor = defaultButtonColor;
        dateButton.style.color           = 'white';
        dateButton.style.border          = 'none';
        dateButton.style.padding         = '5px 10px 3px 10px';
        dateButton.style.cursor          = 'pointer';
        dateButton.style.borderRadius    = '3px';
        dateButton.style.fontSize        = '18px';
        dateButton.style.marginLeft      = '20px';
        dateButton.style.width           = '56px';
        dateButton.onmouseover = () => {
            dateButton.style.backgroundColor = isButtonSelected(dateButton) ? activeButtonColorHovered : defaultButtonColorHovered;
        };
        dateButton.onmouseout = () => {
            dateButton.style.backgroundColor = isButtonSelected(dateButton) ? activeButtonColor : defaultButtonColor;
        };
        let isNewOrder = true;
        dateButton.onclick = () => {
            if (isButtonSelected(scoreButton)) { hiddenVideoNumber = 0; updateImageCounter(); }
            if (isButtonSelected(dateButton)) {
                isNewOrder = !isNewOrder;
                dateButton.textContent = isNewOrder ? 'New' : 'Old';
            } else {
                selectButton(dateButton);
            }
            updateCurrentResults(isNewOrder ? results.slice() : results.slice().reverse());
        };

        selectButton(dateButton); // Standard: New

        // Layout aufbauen
        controlsContainer.appendChild(toggleRemoveLabelContainer);
        controlsContainer.appendChild(randomizeButton);
        controlsContainer.appendChild(dateButton);
        controlsContainer.appendChild(scoreButton);

        function updateLayout() {
            const w = window.innerWidth || document.documentElement.clientWidth;
            if (w >= 1250) {
                randomizeButton.style.marginLeft = '50px';
                headerContainer.style.flexDirection  = 'row';
                headerContainer.style.alignItems     = 'center';
                headerContainer.style.position       = 'relative';
                headerContainer.style.marginTop      = '0px';
                imageCount.style.position    = 'absolute';
                imageCount.style.marginBottom = '0';
                imageCount.style.marginLeft   = '600px';
                controlsContainer.style.flexDirection  = 'row';
                controlsContainer.style.justifyContent = 'flex-start';
                controlsContainer.style.marginTop      = '0px';
                headerContainer.appendChild(controlsContainer);
                headerContainer.appendChild(imageCount);
            } else if (w >= 600) {
                randomizeButton.style.marginLeft = '50px';
                headerContainer.style.flexDirection = 'column';
                headerContainer.style.alignItems    = 'flex-start';
                imageCount.style.position    = 'relative';
                imageCount.style.marginBottom = '0px';
                imageCount.style.marginLeft   = '10px';
                controlsContainer.style.flexDirection  = 'row';
                controlsContainer.style.justifyContent = 'flex-start';
                controlsContainer.style.marginTop      = '0px';
                headerContainer.appendChild(imageCount);
                headerContainer.appendChild(controlsContainer);
            } else {
                randomizeButton.style.marginLeft = '0px';
                headerContainer.style.flexDirection = 'column';
                headerContainer.style.alignItems    = 'flex-start';
                imageCount.style.position    = 'relative';
                imageCount.style.marginBottom = '10px';
                imageCount.style.marginLeft   = '0px';
                controlsContainer.style.flexDirection  = 'row';
                controlsContainer.style.justifyContent = 'flex-start';
                controlsContainer.style.marginTop      = '10px';
                headerContainer.appendChild(imageCount);
                headerContainer.appendChild(controlsContainer);
            }
        }
        updateLayout();
        if (activeModalResizeHandler) {
            window.removeEventListener('resize', activeModalResizeHandler);
        }
        activeModalResizeHandler = updateLayout;
        window.addEventListener('resize', updateLayout);

        resultContainer.appendChild(headerContainer);

        const spacer = document.createElement('div');
        spacer.style.width  = '100%';
        spacer.style.height = '20px';
        resultContainer.appendChild(spacer);
        resultContainer.appendChild(imagesContainer);

        document.body.appendChild(resultContainer);

        // ESC → zurück zur Fav-Seite (Original-Verhalten)
        if (!modalEscListenerBound) {
            document.addEventListener('keydown', handleModalEscape);
            modalEscListenerBound = true;
        }

        // ── appendResult ──────────────────────────────────────────────────────
        function appendResult(result) {
            if (!result) return;
            const resultItem = document.createElement('div');
            resultItem.className       = 'resultItem';
            resultItem.id              = `favorite-${result.id}`;
            resultItem.style.textAlign  = 'center';
            resultItem.style.width      = `${columnWidth}px`;
            resultItem.style.marginRight  = '10px';
            resultItem.style.marginBottom = '10px';
            resultItem.style.alignSelf  = 'flex-start';
            resultItem.style.position   = 'relative';
            resultItem.style.transition = 'height 0.15s';

            const removeLabel = document.createElement('a');
            removeLabel.href              = '#';
            removeLabel.className         = 'removeLabel';
            removeLabel.style.color       = darkMode ? textColor : '#009';
            removeLabel.style.fontWeight  = 'bold';
            removeLabel.style.textDecoration = 'none';
            removeLabel.style.fontFamily  = 'Verdana, sans-serif';
            removeLabel.style.fontSize    = '100%';
            removeLabel.style.display     = removeLabelsShown ? 'inline' : 'none';
            removeLabel.textContent       = 'Remove';

            resultItem.style.height = removeLabelsShown ? '275px' : '250px';

            removeLabel.onclick = event => {
                addToRemovalQueue(result.id);
                event.preventDefault();
                fetch(`index.php?page=favorites&s=delete&id=${result.id}`)
                    .then(resp => {
                        if (resp.ok) {
                            const el = document.getElementById(`favorite-${result.id}`);
                            if (el) {
                                const i1 = results.indexOf(result);
                                const i2 = currentResults.indexOf(result);
                                if (i1 > -1) results.splice(i1, 1);
                                if (i2 > -1) currentResults.splice(i2, 1);
                                resultIds.delete(result.id);
                                el.remove();
                                updateImageCounter();
                            }
                        }
                    })
                    .catch(e => console.error('Error:', e));
            };

            const link = document.createElement('a');
            link.href = `index.php?page=post&s=view&id=${result.id}`;
            link.id = `p${result.id}`;
            link.target = '_blank';

            const img = document.createElement('img');
            img.src = result.src;
            img.title = '';
            img.border = '0';
            img.alt = '';
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.marginBottom = '5px';
            if (result.video) img.style.border = '3px solid rgb(0, 0, 255)';

            link.appendChild(img);
            resultItem.appendChild(link);
            resultItem.appendChild(document.createElement('br'));
            resultItem.appendChild(removeLabel);
            imagesContainer.appendChild(resultItem);
        }

        // ── showResults / updateCurrentResults ────────────────────────────────
        function showResults(arr) {
            imagesContainer.querySelectorAll('.resultItem').forEach(el => el.remove());
            cropCurrentPage(arr, currentPage, imagesPerPage).forEach(r => appendResult(r));
        }

        function updateCurrentResults(arr) {
            currentPage    = 1;
            currentResults = arr;
            showResults(arr);
        }

        // Initiales Rendering
        currentResults = results.slice();
        showResults(currentResults);
    }

    // ── renderResultsToGalleryChunked ─────────────────────────────────────────
    // Rendert Favoriten in die existierende rule34-Gallery (#content > div.image-list)
    function renderResultsToGalleryChunked(batchSize = 50) {
        const imageList = document.querySelector('#content > div.image-list');
        if (!imageList) return;

        imageList.innerHTML = '';
        let index       = 0;
        let isRendering = false;

        const sentinel = document.createElement('div');
        sentinel.id           = 'lazy-sentinel';
        sentinel.style.height = '1px';
        sentinel.style.margin = '30px auto';
        imageList.appendChild(sentinel);

        function renderChunk() {
            if (isRendering) return;
            isRendering = true;

            const fragment = document.createDocumentFragment();
            for (let i = 0; i < batchSize && index < results.length; i++, index++) {
                const post = results[index];

                const outerSpan = document.createElement('span');
                outerSpan.style.alignSelf        = 'flex-start';
                outerSpan.style.display          = 'grid';
                outerSpan.style.gridTemplateRows = 'auto 10px';

                const thumb = document.createElement('span');
                thumb.className = 'thumb';

                const a = document.createElement('a');
                a.href    = post.link;
                a.id      = `p${post.id}`;
                a.onclick = function () { document.location = post.link; return false; };

                const img = document.createElement('img');
                img.src            = post.src;
                img.alt            = 'image_thumb';
                img.title          = `Score: ${post.score || 0}`;
                img.border         = '0';
                img.loading        = 'lazy';
                img.decoding       = 'async';
                img.referrerPolicy = 'no-referrer';

                a.appendChild(img);
                thumb.appendChild(a);

                const remove = document.createElement('a');
                remove.href    = '#';
                remove.onclick = function () {
                    document.location = `index.php?page=favorites&s=delete&id=${post.id}&return`;
                    return false;
                };
                const removeText = document.createElement('b');
                removeText.textContent = 'Remove';
                remove.appendChild(removeText);

                outerSpan.appendChild(thumb);
                outerSpan.appendChild(document.createElement('br'));
                outerSpan.appendChild(remove);
                fragment.appendChild(outerSpan);
            }

            imageList.insertBefore(fragment, sentinel);
            isRendering = false;

            if (index >= results.length) { observer.disconnect(); sentinel.remove(); }
        }

        const observer = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && !isRendering) renderChunk();
        });
        observer.observe(sentinel);
        renderChunk();
    }

    // ── Visibility / Tab-Wechsel ──────────────────────────────────────────────
    let favCountOnLastUpdate;

    async function fastCheckForScanIsNeeded() {
        const savedUserId = loadSavedUserId();
        if (!savedUserId) return false;
        if (getIdFromUrl() != savedUserId) {
            return document.getElementById('progress')?.textContent !== 'new user';
        }
        return getFavoritesCount(userId).then(favCount => {
            const haveNew = favCount != favCountOnLastUpdate;
            if (haveNew && favCountOnLastUpdate) { favCountOnLastUpdate = favCount; return true; }
            return false;
        });
    }

    function switchedToFavPage() {
        fastCheckForScanIsNeeded().then(result => { if (result) location.reload(); });
    }

    function visibilityChangeHandler() {
        if (document.visibilityState === 'visible') switchedToFavPage();
    }

    // ── init ──────────────────────────────────────────────────────────────────
    function init() {
        createHeaderUI();

        document.addEventListener('click', function (e) {
            const target = e.target.closest('a');
            if (target?.getAttribute('onclick')?.includes('favorites&s=delete')) {
                const m = target.getAttribute('onclick').match(/id=(\d+)/);
                if (m) { removeFromAdditionalQueue(m[1]); addToRemovalQueue(m[1]); }
            }
        }, true);

        document.addEventListener('visibilitychange', visibilityChangeHandler);

        getFavoritesCount(userId).then(favoritesCount => {
            actualFavCount       = favoritesCount;
            favCountOnLastUpdate = favoritesCount;

            loadAllImagesFromLocalStorage(loadedImgs => {
                const removalSet = new Set(getRemovalQueue());
                loadedImages = loadedImgs.filter(img => !removalSet.has(img.id));

                needScan = true;
                fullScan = true;

                if (prevUserId) {
                    if (userId == prevUserId) {
                        if (prevFavCount > 0 && loadedImages.length > 0) {
                            fullScan = false;
                            const loadedFirstId = loadedImages[0].id;

                            function getFirstIdCheck() {
                                const pid = new URLSearchParams(window.location.search).get('pid');
                                return (pid === '0' || pid === null)
                                    ? Promise.resolve(document)
                                    : fetchFavoritesPage(0);
                            }

                            getFirstIdCheck().then(pageDoc => {
                                const firstThumb = pageDoc?.querySelector('.thumb img');
                                const actualFirstId = firstThumb?.parentElement?.href?.split('id=')[1];
                                if (!actualFirstId) {
                                    displayScanStatus('need scan');
                                    return;
                                }
                                if ((loadedFirstId != actualFirstId && !fromBack) || (favoritesCount != prevFavCount)) {
                                    displayScanStatus('scanned (new)');
                                } else {
                                    needScan = false;
                                    allImages = loadedImages;
                                    allImageIds = new Set(loadedImages.map(img => img.id));
                                    displayScanStatus('scanned');
                                }
                            });
                        } else {
                            displayScanStatus('need scan');
                        }
                    } else {
                        displayScanStatus('new user');
                    }
                } else {
                    displayScanStatus('need scan');
                }
            });
        });
    }

    // ── exploreModule (Highlighting) ──────────────────────────────────────────
    const exploreModule = (() => {
        const BORDER_COLOR = '#ff0000';
        const BORDER_WIDTH = '2.5px';

        function onPostPage() {
            const orig = window.addFav;
            window.addFav = function (postId) {
                addToAdditionalQueue(postId);
                orig.apply(this, arguments);
            };
        }

        function handleUserReturn() {
            const additionalSet = new Set(getAdditionalQueue());
            if (additionalSet.size === 0) return;
            document.querySelectorAll('div.image-list span.thumb img').forEach(img => {
                if (additionalSet.has(getThumbImgId(img))) {
                    img.style.boxShadow = `0 0 0 ${BORDER_WIDTH} ${BORDER_COLOR}`;
                    img.style.opacity   = '0.3';
                }
            });
        }

        function addImageBorderById(id) {
            const span = document.getElementById(`s${id}`);
            if (span) {
                const img = span.querySelector('img');
                if (img) {
                    img.style.boxShadow = `0 0 0 ${BORDER_WIDTH} ${BORDER_COLOR}`;
                    img.style.opacity   = '0.3';
                }
            }
        }

        function highlightFavs() {
            const orig = window.addFav;
            window.addFav = function (postId) {
                addToAdditionalQueue(postId);
                orig.apply(this, arguments);
                if (borderFavs) addImageBorderById(postId);
            };

            const saved = localStorage.getItem('borderFavs');
            borderFavs = saved ? JSON.parse(saved) : true;

            if (!borderFavs) return;

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') handleUserReturn();
            });

            loadAllImagesFromLocalStorage(loadedImgs => {
                const idSet         = new Set(loadedImgs.map(img => img.id));
                const additionalSet = new Set(getAdditionalQueue());
                const removalSet    = new Set(getRemovalQueue());

                if (loadedImgs.length === 0) return;

                document.querySelectorAll('div.image-list span.thumb img').forEach(img => {
                    const imgId = getThumbImgId(img);
                    if (additionalSet.has(imgId) || (idSet.has(imgId) && !removalSet.has(imgId))) {
                        img.style.boxShadow = `0 0 0 ${BORDER_WIDTH} ${BORDER_COLOR}`;
                        img.style.opacity   = '0.3';
                    }
                });
            });
        }

        return { highlightFavs, onPostPage };
    })();

    // ── Entry Points ──────────────────────────────────────────────────────────
    if (pageType === PageType.FAVORITE_VIEW) {
        darkMode  = isDarkMode();
        textColor = darkMode ? 'white' : 'black';
        userId    = getIdFromUrl();
        exploreModule.highlightFavs();
        loadSavedData();
        init();
    } else if (pageType === PageType.POST_LIST) {
        exploreModule.highlightFavs();
    } else if (pageType === PageType.POST_VIEW) {
        exploreModule.highlightFavs();
    }

})();
