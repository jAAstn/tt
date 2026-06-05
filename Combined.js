// ==UserScript==
// @name         Combined r34 Scripts++ (Optimized - DeepSeek & Claude)
// @namespace    http://tampermonkey.net/
// @version      4.24-enhanced
// @description  Combines multiple scripts for rule34 with extreme performance improvements, UI Panel, and API key support.
// @author       Ich -> Gemini Pro 3.1 -> DeepSeek -> Claude
// @match        https://rule34.xxx/*
// @icon         data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAElBMVEX///8AAAAAGVQALYondf////+67aQPAAAAAXRSTlMBN+Ho8AAAAShJREFUeNrt3c0RgyAQBlBbsIW0kBbSgv23kotcNsPwM0xck/fdkAUfNwdG3bYzzy9niwEAAAAAAAC4DBA7jkr2kN4btcYDAAAAAAAA5AHUCktGIb0LAAAAAAAAAMgD2BvpBcQ6AAAAAAAAgPsCRjcaav0AAAAAAAAA9wHMHljM9pcAAAAAAAAA5AOMblAckwEAAAAAAAD4HcDsQQcAAAAAAABAPkAsHD2wqC0EAAAAAAAA4D6A1oZDbYJlLzwCAAAAAAAApAH0pvcDCK1xAAAAAAAAAHkAvZBS92gkzlcbBwAAAAAAAJAHUC68zpSBsb26DgAAAAAAACAfoDXh6joAAAAAAACAfABPRAAAAAAAAP8HKIkPELX2qrqPPzwCAAAAAAAAXAV4A8N+Sq06PvkiAAAAAElFTkSuQmCC
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      api.rule34.xxx
// @connect      rule34.xxx
// @connect      wimg.rule34.xxx
// @connect      api-cdn.rule34.xxx
// ==/UserScript==

(function() {
    'use strict';

    // Cleanup-Liste für Observer beim Page Unload
    let observers = [];

    // --- KONSTANTEN & CONFIG ---
    const API_KEY_NAME = 'r34_api_key';
    const USER_ID_NAME = 'r34_user_id';
    const REMINDER_KEY = 'r34_api_reminder';

    const CONSTANTS = {
        PER_PAGE_FAVORITES: 50,
        PER_PAGE_DEFAULT: 42,
        HEADER_COLLAPSED_HEIGHT: '40px',
        DEBOUNCE_MUTATION_MS: 150,
        DEBOUNCE_URL_MS: 150,
        API_RETRY_ATTEMPTS: 3,
        BANNER_DISPLAY_MS: 3000,
        HEADER_EXPAND_DELAY_MS: 250,
        HEADER_COLLAPSE_DELAY_MS: 100,
        API_TIMEOUT_MS: 10000,
        PERFORMANCE_MONITORING: false,
    };

    const DEFAULT_CONFIG = {
        favoriteOnMouse: true,
        hideBlacklisted: true,
        removeDuplicates: true,
        removeAnnoyances: true,
        collapsibleHeader: true,
        fixPaginatorLinks: true,
        removePidParameter: true,
        nativeLazyLoading: true,
        restoreDeletedPost: true,
        hideEmptyThumbSpans: true,
        faviconChanger: true,
        pageIndicator: true,
        removeThumbTitles: true,
        apiInfiniteScroll: false,
        advancedImageLoading: true,  // NEU: Aktiviert SmartImageLoader
    };

    const getPerPage = () => location.href.includes('page=favorites') ? CONSTANTS.PER_PAGE_FAVORITES : CONSTANTS.PER_PAGE_DEFAULT;

    // --- SMART IMAGE LOADER (DeepSeek's ImageLoadScheduler, optimiert) ---
    const SmartImageLoader = (() => {
        'use strict';

        let queue = [];
        let activeDownloads = 0;
        let frameRequestId = null;
        let isThrottling = false;

        const CONCURRENT_LIMIT = 4;        // Chromium kann 6-8 handhaben, aber 4 hält Thread frei
        const FRAME_BUDGET_MS = 12;         // ~70% of 16.6ms frame
        let lastFrameStart = 0;

        // Prioritäts-Tiers basierend auf Viewport-Position
        function getPriority(imgEl) {
            const rect = imgEl.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // 0 = im Viewport, 1 = nächste Screen, 2 = rest
            if (rect.top < viewportHeight && rect.bottom > 0) return 0;
            if (rect.top < viewportHeight * 2 && rect.bottom > -viewportHeight) return 1;
            return 2;
        }

        function sortQueue() {
            queue.sort((a, b) => getPriority(a.img) - getPriority(b.img));
        }

        function loadNextBatch() {
            if (!frameRequestId && queue.length > 0 && activeDownloads < CONCURRENT_LIMIT) {
                frameRequestId = requestAnimationFrame((now) => {
                    frameRequestId = null;
                    const start = performance.now();
                    let processed = 0;

                    while (queue.length > 0 && activeDownloads < CONCURRENT_LIMIT && (performance.now() - start) < FRAME_BUDGET_MS) {
                        const item = queue.shift();
                        if (!item.img.parentNode) continue; // Image wurde aus DOM entfernt

                        activeDownloads++;
                        processed++;

                        // Setze src jetzt – decoding läuft async aber verteilt
                        const src = item.img.dataset.originalSrc || item.src;
                        if (src) {
                            item.img.src = src;
                            if (item.img.dataset.originalSrc) delete item.img.dataset.originalSrc;
                        }

                        // Track decode-Completion um Slot schneller freizugeben
                        if ('decode' in item.img) {
                            item.img.decode().finally(() => {
                                activeDownloads--;
                                if (queue.length > 0) loadNextBatch();
                            });
                        } else {
                            // Fallback für ältere Browser
                            item.img.onload = item.img.onerror = () => {
                                activeDownloads--;
                                if (queue.length > 0) loadNextBatch();
                            };
                        }
                    }

                    if (queue.length > 0) loadNextBatch();
                });
            }
        }

        function add(imgElement, src) {
            if (!imgElement) return;
            imgElement.dataset.originalSrc = src;
            imgElement.loading = 'lazy';
            queue.push({ img: imgElement, src: src });
            sortQueue();
            loadNextBatch();
        }

        function addBatch(imgElements) {
            imgElements.forEach(img => {
                if (img && img.dataset.originalSrc) {
                    queue.push({ img: img, src: img.dataset.originalSrc });
                }
            });
            sortQueue();
            loadNextBatch();
        }

        function clear() {
            queue = [];
            if (frameRequestId) {
                cancelAnimationFrame(frameRequestId);
                frameRequestId = null;
            }
            activeDownloads = 0;
        }

        function getStats() {
            return {
                queued: queue.length,
                activeDownloads,
                totalProcessed: queue.length + activeDownloads
            };
        }

        return { add, addBatch, clear, getStats };
    })();

    // --- API-BASIERTES INFINITE SCROLLING ---
    const InfiniteScrollAPI = (() => {
        'use strict';

        const CONFIG = {
            enabled: true,
            perPage: 42,
            threshold: 800,
            delayBetweenPages: 2500,
            jitterFactor: 0.5,
            maxPagesPerSession: 500,
            cooldownAfterPages: 50,
            cooldownDuration: 15000,
            maxEmptyPagesInRow: 3,
            useAlternateApiMethod: true,
        };

        let isLoading = false;
        let scheduledLoad = false;
        let currentPid = 0;
        let pagesLoaded = 0;
        let lastApiCall = 0;
        let sessionPostIds = new Set();
        let observer = null;
        let sentinel = null;
        let emptyPagesCount = 0;
        let totalPostCount = 0;
        let currentPage = 1;
        let postsLoadedCount = 0;
        let reachedEnd = false;
        let consecutiveEmptyPages = 0;
        let highestPidSeen = 0;
        let debugMode = CONSTANTS.PERFORMANCE_MONITORING;

        function getState() {
            return {
                currentPage,
                totalPostCount,
                perPage: CONFIG.perPage,
                postsLoaded: postsLoadedCount,
                pagesLoaded,
                isLoading,
                reachedEnd,
                highestPidSeen
            };
        }

        function isApplicablePage() {
            const url = location.href;
            return !url.includes('page=post&s=view') &&
                !url.includes('page=favorites') &&
                !url.includes('page=account') &&
                document.querySelector('#content, .image-list') !== null;
        }

        function getCurrentPid() {
            const urlParams = new URLSearchParams(location.search);
            const pid = parseInt(urlParams.get('pid'), 10);
            return isNaN(pid) ? 0 : pid;
        }

        async function calculateDelay() {
            const now = Date.now();
            const timeSinceLastCall = now - lastApiCall;
            let baseDelay = CONFIG.delayBetweenPages;
            if (pagesLoaded > CONFIG.cooldownAfterPages) baseDelay = CONFIG.cooldownDuration;
            else if (pagesLoaded > 30) baseDelay = 5000;
            else if (pagesLoaded > 15) baseDelay = 3500;
            if (consecutiveEmptyPages > 0) baseDelay += consecutiveEmptyPages * 1000;
            const jitter = baseDelay * (Math.random() * CONFIG.jitterFactor * 2 - CONFIG.jitterFactor);
            let waitTime = baseDelay + jitter - timeSinceLastCall;
            waitTime = Math.max(1000, Math.min(20000, waitTime));
            console.log(`[API-Scroll] Warte ${(waitTime/1000).toFixed(1)}s (Seite ${pagesLoaded + 1})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        function createThumbFromApiData(post) {
            const span = document.createElement('span');
            span.className = 'thumb';
            span.id = `s${post.id}`;
            const thumbUrl = post.preview_url || post.sample_url || post.file_url;
            const link = document.createElement('a');
            link.href = `index.php?page=post&s=view&id=${post.id}`;
            link.id = `p${post.id}`;
            const img = document.createElement('img');

            // NEU: Verwende SmartImageLoader wenn aktiviert
            if (window.CONFIG?.advancedImageLoading) {
                img.dataset.originalSrc = thumbUrl;
                img.loading = 'lazy';
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                img.alt = post.tags || '';
                SmartImageLoader.add(img, thumbUrl);
            } else {
                img.src = thumbUrl;
                img.loading = 'lazy';
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                img.alt = post.tags || '';
            }

            img.removeAttribute('title');

            if (['webm', 'mp4'].includes(post.file_url?.split('.').pop().toLowerCase())) {
                const indicator = document.createElement('div');
                indicator.style.cssText = 'position:absolute;bottom:5px;right:5px;background:rgba(0,0,0,0.7);color:#fff;padding:2px 5px;border-radius:3px;font-size:11px;';
                indicator.textContent = '▶';
                span.style.position = 'relative';
                span.appendChild(indicator);
            }
            link.appendChild(img);
            span.appendChild(link);
            return span;
        }

        async function diagnoseApiIssue() {
            console.log('[API-Scroll] 🔍 DIAGNOSE: Analysiere API-Problem...');
            const tags = new URLSearchParams(location.search).get('tags') || '';
            const testPids = [0, 42, 126, 168, 252, 420, 1000, 2000];

            for (const testPid of testPids) {
                try {
                    const baseUrl = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&pid=${testPid}&limit=1&json=1`;

                    if (tags) {
                        const resp1 = await GM.xmlHttpRequest({ method: 'GET', url: baseUrl + `&tags=${encodeURIComponent(tags)}`, timeout: 5000, responseType: 'json' });
                        const hasData1 = resp1.response && (Array.isArray(resp1.response) ? resp1.response.length > 0 : resp1.response.id);
                        console.log(`[API-Scroll] PID ${testPid}: mit Tags=${hasData1}`);
                        if (hasData1) {
                            console.log(`[API-Scroll] ✓ API funktioniert bei PID ${testPid} (mit Tags)`);
                            return { success: true, workingPid: testPid, withTags: true, withoutTags: false };
                        }
                    }

                    const resp2 = await GM.xmlHttpRequest({ method: 'GET', url: baseUrl, timeout: 5000, responseType: 'json' });
                    const hasData2 = resp2.response && (Array.isArray(resp2.response) ? resp2.response.length > 0 : resp2.response.id);
                    console.log(`[API-Scroll] PID ${testPid}: ohne Tags=${hasData2}`);
                    if (hasData2) {
                        console.log(`[API-Scroll] ✓ API funktioniert bei PID ${testPid} (ohne Tags)`);
                        return { success: true, workingPid: testPid, withTags: false, withoutTags: true };
                    }

                    await new Promise(r => setTimeout(r, 500));
                } catch (e) {
                    console.debug(`[API-Scroll] Diagnose-Fehler bei PID ${testPid}:`, e.message);
                }
            }

            console.log('[API-Scroll] ✗ API scheint komplett leer zu sein');
            return { success: false };
        }

        async function loadNextPageViaHtml() {
            console.log('[API-Scroll] 🔄 Wechsle zu HTML-basierter Navigation (Fallback)');

            const nextLink = [...document.querySelectorAll('.pagination a')].find(a =>
                a.getAttribute('alt') === 'next' ||
                a.textContent.trim() === '»' ||
                a.textContent.toLowerCase().includes('next')
            );
            if (!nextLink) {
                console.log('[API-Scroll] Kein Next-Link gefunden - Ende');
                return false;
            }

            try {
                const nextUrl = nextLink.href;
                console.log(`[API-Scroll] Lade HTML-Seite: ${nextUrl}`);

                const response = await GM.xmlHttpRequest({ method: 'GET', url: nextUrl, timeout: 15000 });
                if (response.status !== 200) return false;

                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, 'text/html');
                const thumbs = doc.querySelectorAll('span.thumb');
                const container = document.querySelector('#content .image-list') || document.querySelector('#content');
                if (!container) return false;

                let addedCount = 0;
                const fragment = document.createDocumentFragment();
                const imagesToLoad = [];

                for (const thumb of thumbs) {
                    const id = thumb.id?.slice(1);
                    if (!id || sessionPostIds.has(String(id))) continue;

                    const link = thumb.querySelector('a');
                    const img = thumb.querySelector('img');
                    if (!link || !img) continue;

                    sessionPostIds.add(String(id));

                    const newThumb = document.createElement('span');
                    newThumb.className = 'thumb';
                    newThumb.id = thumb.id;

                    const newLink = document.createElement('a');
                    newLink.href = link.href;
                    newLink.id = link.id;

                    const newImg = document.createElement('img');
                    newImg.src = img.src;
                    newImg.loading = 'lazy';
                    newImg.decoding = 'async';
                    newImg.referrerPolicy = 'no-referrer';
                    newImg.alt = img.alt || '';

                    if (window.CONFIG?.advancedImageLoading) {
                        newImg.dataset.originalSrc = img.src;
                        imagesToLoad.push(newImg);
                    }

                    newLink.appendChild(newImg);
                    newThumb.appendChild(newLink);
                    fragment.appendChild(newThumb);
                    addedCount++;
                }

                if (addedCount > 0) {
                    container.appendChild(fragment);

                    // Batch-lade die Bilder mit SmartImageLoader
                    if (window.CONFIG?.advancedImageLoading && imagesToLoad.length > 0) {
                        SmartImageLoader.addBatch(imagesToLoad);
                    }

                    const nextUrlParams = new URLSearchParams(new URL(nextUrl).search);
                    const nextPid = parseInt(nextUrlParams.get('pid'), 10);
                    if (!isNaN(nextPid)) currentPid = nextPid;

                    pagesLoaded++;
                    currentPage = Math.floor(currentPid / CONFIG.perPage) + 1;
                    postsLoadedCount = sessionPostIds.size;

                    console.log(`[API-Scroll] HTML: ${addedCount} neue Posts geladen (Seite ${pagesLoaded})`);
                    repositionSentinel();
                    if (typeof updatePageIndicator === 'function') updatePageIndicator();
                    return true;
                }

                return false;
            } catch (error) {
                console.error('[API-Scroll] HTML-Fehler:', error);
                return false;
            }
        }

        function scheduleNextLoad(delayMs) {
            if (scheduledLoad || reachedEnd) return;
            scheduledLoad = true;
            setTimeout(() => {
                scheduledLoad = false;
                loadNextPage();
            }, delayMs);
        }

        async function loadNextPage() {
            if (isLoading) return false;
            if (reachedEnd) return false;
            if (pagesLoaded >= CONFIG.maxPagesPerSession) {
                reachedEnd = true;
                return false;
            }

            isLoading = true;

            try {
                await calculateDelay();

                if (consecutiveEmptyPages >= 3 && CONFIG.useAlternateApiMethod) {
                    console.log('[API-Scroll] Zu viele leere API-Seiten - wechsle zu HTML-Methode');
                    const htmlSuccess = await loadNextPageViaHtml();
                    if (htmlSuccess) {
                        emptyPagesCount = 0;
                        consecutiveEmptyPages = 0;
                    }
                    return htmlSuccess;
                }

                let nextPid = currentPid + CONFIG.perPage;

                if (pagesLoaded === 3 && emptyPagesCount > 0 && debugMode) {
                    const diag = await diagnoseApiIssue();
                    if (!diag.success) {
                        console.log('[API-Scroll] API scheint nicht zu funktionieren - wechsle zu HTML');
                        return await loadNextPageViaHtml();
                    }
                    debugMode = false;
                }

                const apiKey = await GM_getValue(API_KEY_NAME, '');
                const userId = await GM_getValue(USER_ID_NAME, '');
                const urlParams = new URLSearchParams(location.search);
                const tags = urlParams.get('tags') || '';

                let apiUrl = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&pid=${nextPid}&limit=${CONFIG.perPage}&json=1`;
                if (tags && consecutiveEmptyPages < 2) apiUrl += `&tags=${encodeURIComponent(tags)}`;
                if (apiKey && userId) apiUrl += `&api_key=${apiKey}&user_id=${userId}`;

                console.log(`[API-Scroll] Lade Seite ${pagesLoaded + 1} (PID: ${nextPid})`);

                const response = await GM.xmlHttpRequest({
                    method: 'GET',
                    url: apiUrl,
                    timeout: 15000,
                    responseType: 'json'
                });

                lastApiCall = Date.now();

                if (response.status !== 200 || !response.response) {
                    throw new Error(`API-Fehler: ${response.status}`);
                }

                const posts = Array.isArray(response.response) ? response.response : [response.response];

                if (posts.length === 0 || (posts.length === 1 && !posts[0].id)) {
                    emptyPagesCount++;
                    consecutiveEmptyPages++;
                    console.log(`[API-Scroll] Leere Seite bei PID ${nextPid}`);
                    currentPid = nextPid;
                    repositionSentinel();
                    scheduleNextLoad(800);
                    return false;
                }

                emptyPagesCount = 0;
                consecutiveEmptyPages = 0;

                const container = document.querySelector('#content .image-list') || document.querySelector('#content');
                if (!container) throw new Error('Container nicht gefunden');

                let addedCount = 0;
                const fragment = document.createDocumentFragment();

                for (const post of posts) {
                    if (!post.id) continue;
                    if (sessionPostIds.has(String(post.id))) continue;
                    if (post.blacklisted || post.pending) continue;

                    sessionPostIds.add(String(post.id));
                    fragment.appendChild(createThumbFromApiData(post));
                    addedCount++;
                }

                if (addedCount > 0) {
                    container.appendChild(fragment);
                    currentPid = nextPid;
                    pagesLoaded++;
                    currentPage = Math.floor(currentPid / CONFIG.perPage) + 1;
                    postsLoadedCount = sessionPostIds.size;

                    console.log(`[API-Scroll] ${addedCount} neue Posts geladen (Seite ${pagesLoaded})`);
                    repositionSentinel();

                    if (typeof updatePageIndicator === 'function') {
                        if (totalPostCount > 0) updatePageIndicator.setTotalPostCount(totalPostCount, CONFIG.perPage);
                        updatePageIndicator();
                    }

                    return true;
                } else {
                    console.log('[API-Scroll] Keine neuen Posts (Duplikate)');
                    currentPid = nextPid;
                    repositionSentinel();
                    scheduleNextLoad(500);
                    return false;
                }

            } catch (error) {
                console.error('[API-Scroll] Fehler:', error);
                emptyPagesCount++;
                consecutiveEmptyPages++;
                return false;
            } finally {
                isLoading = false;
            }
        }

        function repositionSentinel() {
            if (!sentinel) return;
            sentinel.remove();
            const container = document.querySelector('#content .image-list') || document.querySelector('#content');
            if (container) container.appendChild(sentinel);
        }

        function createSentinel() {
            sentinel = document.createElement('div');
            sentinel.id = 'api-scroll-sentinel';
            sentinel.style.cssText = 'height:10px;width:100%;margin:20px 0;';
            const indicator = document.createElement('div');
            indicator.id = 'api-scroll-indicator';
            indicator.textContent = '⏳ Lade weitere Bilder...';
            sentinel.appendChild(indicator);
            return sentinel;
        }

        function initObserver() {
            if (observer) observer.disconnect();
            const container = document.querySelector('#content .image-list') || document.querySelector('#content');
            if (!container) return false;
            sentinel = createSentinel();
            container.appendChild(sentinel);
            observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && !isLoading && !reachedEnd) {
                        const indicator = document.getElementById('api-scroll-indicator');
                        if (indicator) indicator.style.display = 'block';
                        loadNextPage().then((hasMore) => {
                            if (indicator) {
                                if (reachedEnd) {
                                    indicator.textContent = `✓ Ende (${postsLoadedCount} Posts)`;
                                    indicator.style.display = 'block';
                                } else if (!hasMore) {
                                    indicator.style.display = 'none';
                                }
                            }
                        });
                    }
                });
            }, { rootMargin: `${CONFIG.threshold}px 0px`, threshold: 0.1 });
            observer.observe(sentinel);
            return true;
        }

        async function estimateTotalPages() {
            const paginator = document.querySelector('#paginator');
            if (paginator) {
                const lastLink = paginator.querySelector('a[href*="pid"]:last-of-type');
                if (lastLink) {
                    const url = new URL(lastLink.href, location.href);
                    const maxPid = parseInt(url.searchParams.get('pid'), 10);
                    if (!isNaN(maxPid) && maxPid > 0) {
                        totalPostCount = maxPid + CONFIG.perPage;
                        console.log(`[API-Scroll] Geschätzte Gesamtposts: ${totalPostCount}`);
                        return Math.ceil(totalPostCount / CONFIG.perPage);
                    }
                }
            }
            return null;
        }

        async function initialize() {
            if (!CONFIG.enabled) return false;
            if (!isApplicablePage()) {
                console.log('[API-Scroll] Nicht auf dieser Seite aktiv.');
                return false;
            }

            currentPid = getCurrentPid();
            pagesLoaded = 0;
            currentPage = Math.floor(currentPid / CONFIG.perPage) + 1;
            sessionPostIds.clear();
            emptyPagesCount = 0;
            consecutiveEmptyPages = 0;
            reachedEnd = false;
            scheduledLoad = false;
            highestPidSeen = currentPid;
            debugMode = CONSTANTS.PERFORMANCE_MONITORING;

            document.querySelectorAll('span.thumb[id^="s"]').forEach(el => {
                const id = el.id.slice(1);
                if (id) sessionPostIds.add(String(id));
            });

            postsLoadedCount = sessionPostIds.size;
            await estimateTotalPages();

            console.log(`[API-Scroll] Initialisiert. PID: ${currentPid}, Posts: ${postsLoadedCount}`);
            return initObserver();
        }

        function destroy() {
            if (observer) { observer.disconnect(); observer = null; }
            if (sentinel) { sentinel.remove(); sentinel = null; }
            isLoading = false;
            scheduledLoad = false;
            reachedEnd = true;
        }

        return {
            init: initialize,
            destroy,
            loadNextPage,
            isActive: () => observer !== null,
            getState,
            getCurrentPage: () => currentPage,
            getTotalPages: () => totalPostCount > 0 ? Math.ceil(totalPostCount / CONFIG.perPage) : null,
            reset: () => { reachedEnd = false; emptyPagesCount = 0; consecutiveEmptyPages = 0; scheduledLoad = false; }
        };
    })();

    let CONFIG = { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('r34_feature_flags') || '{}') };

    // --- PERFORMANCE MONITORING ---
    const performanceMonitor = {
        enabled: CONSTANTS.PERFORMANCE_MONITORING,
        timings: new Map(),

        start(label) {
            if (!this.enabled) return;
            this.timings.set(label, performance.now());
        },

        end(label) {
            if (!this.enabled) return;
            const start = this.timings.get(label);
            if (start) {
                const duration = performance.now() - start;
                console.debug(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
                this.timings.delete(label);
                return duration;
            }
        },

        measure(label, fn) {
            if (!this.enabled) return fn();
            this.start(label);
            const result = fn();
            this.end(label);
            return result;
        }
    };

    // --- UTILS ---
    const debounce = (fn, ms) => {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    };

    // --- STYLES ---
    GM_addStyle(`
        #header { transition: height 0.3s ease; overflow: hidden; }
        .header-fix-btn { position: absolute; top: 5px; right: 10px; z-index: 1000; padding: 2px 6px; font-size: 12px; cursor: pointer; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; }
        .r34-panel-btn { position:absolute; z-index:10000; padding:4px 8px; font-size:12px; background:#222; color:#eee; border:1px solid #444; border-radius:0px; cursor:move; user-select:none; }
        .r34-panel { position:absolute; background:#1a1a1a; color:#eee; padding:15px; border-radius:8px; font-size:12px; z-index:9999; display:none; font-family:sans-serif; border: 1px solid #555; min-width: 280px; }
        .r34-panel form label { display:block; margin-bottom: 5px; cursor:pointer; }
        .r34-panel form input { margin-right: 8px; }
        .r34-panel form strong { color:#0af; margin-top:10px; display:block; border-bottom: 1px solid #444; padding-bottom: 3px; margin-bottom: 8px; }
        .r34-panel button { margin-top:15px; padding:5px 10px; color:#fff; border:none; border-radius:4px; cursor:pointer; margin-right: 4px; }
        .r34-panel .save-btn { background:#0af; }
        .r34-panel .cancel-btn { background:#444; }
        .r34-panel .minimize-btn { position:absolute; right:5px; top:5px; padding:0 5px; margin:0; background:#333; font-size:14px; }
        #page-indicator { position: fixed; bottom: 10px; right: 10px; background: rgba(30, 30, 30, 0.9); color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-family: monospace; z-index: 9999; pointer-events: none; backdrop-filter: blur(5px); border: 1px solid #444; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: none; }
        .blacklisted-image.thumb, span.blacklisted-image, div.a_list#lmid, div[style*="display: inline-flex"], div.horizontalFlexWithMargins[style*="justify-content: center"], .exo-native-widget-outer-container, span[data-nosnippet] { display: none !important; }
        #r34-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 99999; font-family: sans-serif; }
        #r34-modal-content { background-color: #1e1e1e; color: #eee; padding: 20px 30px; border-radius: 8px; text-align: center; max-width: 400px; border: 1px solid #555; }
        #r34-modal-content p { margin: 0 0 20px 0; line-height: 1.5; }
        #r34-modal-buttons button, #r34-manual-input button { background-color: #333; color: #fff; border: 1px solid #555; padding: 10px 15px; border-radius: 5px; cursor: pointer; margin: 0 10px; }
        #r34-manual-input { margin-top: 20px; }
        #r34-manual-input input { display: block; width: calc(100% - 20px); margin: 10px auto; padding: 8px; background-color: #333; border: 1px solid #555; color: #fff; border-radius: 4px; }
        .tooltip-info { cursor: help; margin-left: 4px; opacity: 0.7; }
        .tooltip-info:hover { opacity: 1; }
        #api-scroll-indicator { text-align: center; padding: 10px; color: #888; font-size: 12px; display: none; }
        /* NEU: Placeholder-Styling für Images ohne src */
        img[data-original-src]:not([src]) {
            background-color: #222;
            display: block;
            min-height: 200px;
        }
    `);

    // --- VALIDIERUNG & CREDENTIALS ---
    const validateCredentials = async (apiKey, userId) => {
        try {
            const testUrl = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&limit=1&json=1&api_key=${apiKey}&user_id=${userId}`;
            const response = await GM.xmlHttpRequest({
                method: 'GET',
                url: testUrl,
                timeout: CONSTANTS.API_TIMEOUT_MS
            });
            return response.status === 200;
        } catch {
            return false;
        }
    };

    async function handleOptionsPage() {
        if (!window.location.href.includes('page=account&s=options')) return;
        const credTextarea = Array.from(document.querySelectorAll('textarea')).find(ta => ta.value.includes('&api_key=') && ta.value.includes('&user_id='));
        if (credTextarea) {
            try {
                const params = new URLSearchParams(credTextarea.value.replace(/&amp;/g, '&'));
                const apiKey = params.get('api_key');
                const userId = params.get('user_id');

                if (apiKey && userId) {
                    const isValid = await validateCredentials(apiKey, userId);
                    if (isValid) {
                        await GM_setValue(API_KEY_NAME, apiKey);
                        await GM_setValue(USER_ID_NAME, userId);
                        const banner = document.createElement('div');
                        banner.textContent = 'Combined r34 Scripts++: API Key and User ID validated and saved!';
                        Object.assign(banner.style, { backgroundColor: '#4CAF50', color: 'white', padding: '15px', textAlign: 'center', position: 'fixed', top: '0', left: '0', width: '100%', zIndex: '10000', fontSize: '16px' });
                        document.body.prepend(banner);
                        setTimeout(() => banner.remove(), CONSTANTS.BANNER_DISPLAY_MS);
                    } else {
                        alert('Invalid API credentials. Please check and try again.');
                    }
                }
            } catch (e) {
                console.error("[Userscript] Could not parse API credentials.", e);
            }
        }
    }

    function showApiKeyPrompt() {
        const lastReminder = localStorage.getItem(REMINDER_KEY);
        if (lastReminder && Date.now() - parseInt(lastReminder) < 24 * 60 * 60 * 1000) return;

        const overlay = document.createElement('div');
        overlay.id = 'r34-modal-overlay';
        overlay.innerHTML = `
            <div id="r34-modal-content">
                <p>For the "Restore Deleted Post" feature, this script now needs an API key. Please generate one or enter it manually.</p>
                <div id="r34-modal-buttons">
                    <button id="r34-manual-btn">Enter Manually</button>
                    <button id="r34-generate-btn">Go to Options Page</button>
                    <button id="r34-later-btn">Remind Later</button>
                </div>
                <div id="r34-manual-input" style="display: none;">
                    <p style="font-size: 0.9em;">Copy the full text from the 'API Access Credentials' box and paste it here.</p>
                    <input type="text" id="r34-credential-input" placeholder="&api_key=...&user_id=...">
                    <button id="r34-save-manual-btn">Save & Reload</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        document.getElementById('r34-generate-btn').addEventListener('click', () => window.location.href = 'https://rule34.xxx/index.php?page=account&s=options');
        document.getElementById('r34-manual-btn').addEventListener('click', () => {
            document.getElementById('r34-modal-buttons').style.display = 'none';
            document.getElementById('r34-manual-input').style.display = 'block';
        });
        document.getElementById('r34-later-btn').addEventListener('click', () => {
            localStorage.setItem(REMINDER_KEY, Date.now().toString());
            overlay.remove();
        });
        document.getElementById('r34-save-manual-btn').addEventListener('click', async () => {
            const credString = document.getElementById('r34-credential-input').value.trim();
            if (!credString) return;
            try {
                const params = new URLSearchParams(credString.startsWith('?') ? credString : '?' + credString);
                const apiKey = params.get('api_key');
                const userId = params.get('user_id');
                if (apiKey && userId) {
                    const isValid = await validateCredentials(apiKey, userId);
                    if (isValid) {
                        await GM_setValue(API_KEY_NAME, apiKey);
                        await GM_setValue(USER_ID_NAME, userId);
                        alert('API Key and User ID validated and saved! The page will now reload.');
                        location.reload();
                    } else {
                        alert('Invalid credentials. Please check and try again.');
                    }
                } else alert('Invalid format. Please paste the full string.');
            } catch (e) { alert('Could not parse the provided string.'); }
        });
    }

    async function checkApiKey() {
        if (window.location.href.includes('page=account&s=options')) return true;
        const apiKey = await GM_getValue(API_KEY_NAME);
        const userId = await GM_getValue(USER_ID_NAME);
        if (!apiKey || !userId) {
            console.log("Combined r34 Scripts++: API key or User ID not found. Displaying prompt.");
            showApiKeyPrompt();
            return false;
        }
        return true;
    }

    async function restoreDeletedPost() {
        performanceMonitor.start('restoreDeletedPost');
        try {
            const notice = document.querySelector('.status-notice');
            if (!notice || !notice.innerText.includes("This post was deleted.")) return;

            const postId = new URLSearchParams(location.search).get('id');
            if (!postId) return;

            const apiKey = await GM_getValue(API_KEY_NAME, '');
            const userId = await GM_getValue(USER_ID_NAME, '');
            const apiUrl = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&id=${postId}&json=1&api_key=${apiKey}&user_id=${userId}`;

            let attempts = 0;
            const maxAttempts = CONSTANTS.API_RETRY_ATTEMPTS;
            let response;

            while (attempts < maxAttempts) {
                try {
                    response = await GM.xmlHttpRequest({
                        method: 'GET',
                        url: apiUrl,
                        responseType: 'json',
                        timeout: CONSTANTS.API_TIMEOUT_MS
                    });

                    if (response.status === 200) break;
                    if (response.status === 429) {
                        const waitTime = Math.pow(2, attempts) * 1000;
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        attempts++;
                        continue;
                    }
                    attempts++;
                } catch (error) {
                    console.debug(`API attempt ${attempts + 1} failed:`, error);
                    attempts++;
                    if (attempts < maxAttempts) await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
            }

            if (!response || response.status !== 200) throw new Error(`Failed after ${maxAttempts} attempts`);

            const data = response.response;
            if (!data) throw new Error("Empty API response");
            const post = Array.isArray(data) ? data[0] : data;
            if (!post?.file_url) throw new Error(`Post not found: ${postId || 'unknown'}`);

            const isVideo = ['webm', 'mp4'].includes(post.file_url.split('.').pop().toLowerCase());
            const mediaElement = document.createElement(isVideo ? 'video' : 'img');
            mediaElement.src = post.file_url;
            Object.assign(mediaElement.style, { maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain', display: 'block' });
            if (isVideo) Object.assign(mediaElement, { controls: true, autoplay: true, loop: true, muted: true });

            const container = document.getElementById('fit-to-screen');
            if (container) {
                container.innerHTML = '';
                container.appendChild(mediaElement);
                notice.innerText += `\n[Userscript] Restored deleted media.`;
            }
        } catch (err) {
            const notice = document.querySelector('.status-notice');
            if (notice) {
                const errorMsg = document.createElement('div');
                errorMsg.style.cssText = 'color:#ff6b6b;margin-top:10px;';
                errorMsg.textContent = '⚠️ Media could not be restored.';
                notice.appendChild(errorMsg);
            }
            console.warn("[Userscript] Could not restore deleted post:", err);
        } finally {
            performanceMonitor.end('restoreDeletedPost');
        }
    }

    // --- CORE FEATURES ---
    const hideBlacklisted = (ctx) => ctx.querySelectorAll?.('.blacklisted').forEach(el => el.remove());

    const removeAnnoyances = (ctx) => ctx.querySelectorAll?.('div.a_list#lmid, div[style*="display: inline-flex"], div.horizontalFlexWithMargins[style*="justify-content: center"], .exo-native-widget-outer-container, span[data-nosnippet]').forEach(el => el.remove());

    const fixPaginatorLinks = (ctx) => ctx.querySelectorAll?.('#paginator a[onclick]').forEach(link => {
        const match = (link.getAttribute('onclick') || '').match(/document\.location='([^']+)'/);
        if (match && link.getAttribute('href') === '#') link.setAttribute('href', match[1]);
    });

    const removePidParameter = (ctx) => ctx.querySelectorAll?.('a[onclick*="return_pid="]').forEach(link => {
        link.setAttribute('onclick', (link.getAttribute('onclick') || '').replace(/[?&]return_pid=\d+/, ''));
    });

    const setNativeLazyLoading = (ctx) => {
        performanceMonitor.start('setNativeLazyLoading');
        let images;
        if (ctx.nodeType === 1 && ctx.matches?.('img:not([loading])')) {
            images = [ctx];
        } else {
            images = ctx.querySelectorAll?.('img:not([loading])');
        }
        if (images?.length) {
            const processImages = () => {
                images.forEach(img => {
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    if (!img.hasAttribute('referrerPolicy')) img.referrerPolicy = 'no-referrer';
                });
            };
            if ('requestIdleCallback' in window) {
                requestIdleCallback(processImages, { timeout: 50 });
            } else {
                setTimeout(processImages, 0);
            }
        }
        performanceMonitor.end('setNativeLazyLoading');
    };

    const hideEmptyThumbSpans = (ctx) => ctx.querySelectorAll?.('#content > div.image-list > span').forEach(span => {
        if (span.children.length === 0 || ![...span.querySelectorAll('a')].some(link => link.style.display !== 'none')) {
            span.remove();
        }
    });

    const removeThumbTitle = (ctx) => ctx.querySelectorAll?.('.thumb img[title]').forEach(img => img.removeAttribute('title'));

    const removeDuplicateThumbnails = (() => {
        const fn = (ctx) => {
            const thumbs = ctx.matches?.('span.thumb')
                ? [ctx]
                : Array.from(ctx.querySelectorAll?.('span.thumb') || []);

            if (thumbs.length === 0) return;

            const batchIds = new Set();
            const toRemove = [];

            thumbs.forEach(el => {
                const id = el.id?.slice(1);
                if (!id) return;

                if (batchIds.has(id)) {
                    toRemove.push(el);
                    return;
                }

                const existing = document.getElementById(`s${id}`);
                if (existing && existing !== el) {
                    toRemove.push(el);
                } else {
                    batchIds.add(id);
                }
            });

            toRemove.forEach(el => el.remove());
        };

        fn.reset = () => {};
        return fn;
    })();

    const updateFavicon = () => {
        try {
            const ICON_MAP = [
                { match: 'page=post&s=view&id=', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAElBMVEX///8AAAAAGVQALYondf////+67aQPAAAAAXRSTlMBN+Ho8AAAAShJREFUeNrt3c0RgyAQBlBbsIW0kBbSgv23kotcNsPwM0xck/fdkAUfNwdG3bYzzy9niwEAAAAAAAC4DBA7jkr2kN4btcYDAAAAAAAA5AHUCktGIb0LAAAAAAAAAMgD2BvpBcQ6AAAAAAAAgPsCRjcaav0AAAAAAAAA9wHMHljM9pcAAAAAAAAA5AOMblAckwEAAAAAAAD4HcDsQQcAAAAAAABAPkAsHD2wqC0EAAAAAAAA4D6A1oZDbYJlLzwCAAAAAAAApAH0pvcDCK1xAAAAAAAAAHkAvZBS92gkzlcbBwAAAAAAAJAHUC68zpSBsb26DgAAAAAAACAfoDXh6joAAAAAAACAfABPRAAAAAAAAP8HKIkPELX2qrqPPzwCAAAAAAAAXAV4A8N+Sq06PvkiAAAAAElFTkSuQmCC' },
                { match: 'user:', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAElBMVEX///8AAABVAHmNAMrNnf////9vNKohAAAAAXRSTlMBN+Ho8AAAAShJREFUeNrt3c0RgyAQBlBbsIW0kBbSgv23kotcNsPwM0xck/fdkAUfNwdG3bYzzy9niwEAAAAAAAC4DBA7jkr2kN4btcYDAAAAAAAA5AHUCktGIb0LAAAAAAAAAMgD2BvpBcQ6AAAAAAAAgPsCRjcaav0AAAAAAAAA9wHMHljM9pcAAAAAAAAA5AOMblAckwEAAAAAAAD4HcDsQQcAAAAAAABAPkAsHD2wqC0EAAAAAAAA4D6A1oZDbYJlLzwCAAAAAAAApAH0pvcDCK1xAAAAAAAAAHkAvZBS92gkzlcbBwAAAAAAAJAHUC68zpSBsb26DgAAAAAAACAfoDXh6joAAAAAAACAfABPRAAAAAAAAP8HKIkPELX2qrqPPzwCAAAAAAAAXAV4A8N+Sq06PvkiAAAAAElFTkSuQmCC' },
                { match: 'page=account&s=profile&uname=', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAElBMVEX///8AAAATExMgICBISEj///+FO3OXAAAAAXRSTlMBN+Ho8AAAAShJREFUeNrt3c0RgyAQBlBbsIW0kBbSgv23kotcNsPwM0xck/fdkAUfNwdG3bYzzy9niwEAAAAAAAC4DBA7jkr2kN4btcYDAAAAAAAA5AHUCktGIb0LAAAAAAAAAMgD2BvpBcQ6AAAAAAAAgPsCRjcaav0AAAAAAAAA9wHMHljM9pcAAAAAAAAA5AOMblAckwEAAAAAAAD4HcDsQQcAAAAAAABAPkAsHD2wqC0EAAAAAAAA4D6A1oZDbYJlLzwCAAAAAAAApAH0pvcDCK1xAAAAAAAAAHkAvZBS92gkzlcbBwAAAAAAAJAHUC68zpSBsb26DgAAAAAAACAfoDXh6joAAAAAAACAfABPRAAAAAAAAP8HKIkPELX2qrqPPzwCAAAAAAAAXAV4A8N+Sq06PvkiAAAAAElFTkSuQmCC' },
                { match: 'page=favorites&s=view&id=', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAElBMVEX///8AAABOAACBEBD/UVH///9FPR7/AAAAAXRSTlMBN+Ho8AAAAShJREFUeNrt3c0RgyAQBlBbsIW0kBbSgv23kotcNsPwM0xck/fdkAUfNwdG3bYzzy9niwEAAAAAAAC4DBA7jkr2kN4btcYDAAAAAAAA5AHUCktGIb0LAAAAAAAAAMgD2BvpBcQ6AAAAAAAAgPsCRjcaav0AAAAAAAAA9wHMHljM9pcAAAAAAAAA5AOMblAckwEAAAAAAAD4HcDsQQcAAAAAAABAPkAsHD2wqC0EAAAAAAAA4D6A1oZDbYJlLzwCAAAAAAAApAH0pvcDCK1xAAAAAAAAAHkAvZBS92gkzlcbBwAAAAAAAJAHUC68zpSBsb26DgAAAAAAACAfoDXh6joAAAAAAACAfABPRAAAAAAAAP8HKIkPELX2qrqPPzwCAAAAAAAAXAV4A8N+Sq06PvkiAAAAAElFTkSuQmCC' },
            ];
            const url = location.href;
            const newIcon = ICON_MAP.find(entry => url.includes(entry.match) || url.includes(entry.match.replace(':', '%3a')))?.icon;
            if (newIcon) {
                let link = document.querySelector('link[rel="shortcut icon"]') || document.querySelector('link[rel="icon"]');
                if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'shortcut icon'); document.head.appendChild(link); }
                link.setAttribute('href', newIcon);
            }
        } catch (e) {}
    };

    const updatePageIndicator = (() => {
        let indicator = null;
        let totalPages = null;
        let apiTotalCount = 0;

        const setTotalPages = (total) => { totalPages = total; updateDisplay(); };
        const setTotalPostCount = (count, perPage = getPerPage()) => {
            apiTotalCount = count;
            totalPages = Math.ceil(count / perPage);
            updateDisplay();
        };

        const getCurrentPage = () => {
            if (typeof InfiniteScrollAPI !== 'undefined' && InfiniteScrollAPI.isActive()) {
                const apiState = InfiniteScrollAPI.getState();
                if (apiState) return apiState.currentPage;
            }
            const urlParams = new URLSearchParams(location.search);
            const pid = parseInt(urlParams.get('pid'), 10);
            if (!isNaN(pid)) return Math.floor(pid / getPerPage()) + 1;
            const paginator = document.querySelector('#paginator');
            if (paginator) {
                const currentPageElem = paginator.querySelector('b');
                if (currentPageElem) return parseInt(currentPageElem.textContent, 10) || 1;
            }
            return 1;
        };

        const getTotalPagesFromPaginator = () => {
            const paginator = document.querySelector('#paginator');
            if (!paginator) return null;
            const perPage = getPerPage();
            const lastLink = paginator.querySelector('a[href*="pid"]:last-of-type');
            if (lastLink) {
                const url = new URL(lastLink.href, location.href);
                const maxPid = parseInt(url.searchParams.get('pid'), 10) || 0;
                return Math.floor(maxPid / perPage) + 1;
            }
            const pageLinks = paginator.querySelectorAll('a[href*="pid"]');
            if (pageLinks.length > 0) {
                const pages = new Set();
                pageLinks.forEach(link => {
                    const url = new URL(link.href, location.href);
                    const pid = parseInt(url.searchParams.get('pid'), 10);
                    if (!isNaN(pid)) pages.add(Math.floor(pid / perPage) + 1);
                });
                return Math.max(...pages, 1);
            }
            return null;
        };

        const updateDisplay = () => {
            if (!indicator) return;
            try {
                const currentPage = getCurrentPage();
                if (totalPages === null) totalPages = getTotalPagesFromPaginator();
                let text = `Page ${currentPage}`;
                if (totalPages !== null && totalPages > 0) text += ` / ${totalPages}`;
                if (typeof InfiniteScrollAPI !== 'undefined' && InfiniteScrollAPI.isActive()) {
                    const apiState = InfiniteScrollAPI.getState();
                    if (apiState && apiState.postsLoaded) text += ` (${apiState.postsLoaded} posts)`;
                }
                indicator.textContent = text;
                indicator.style.display = 'block';
            } catch (e) {
                console.debug('[PageIndicator] Fehler:', e);
            }
        };

        const fn = () => {
            try {
                if (location.href.includes("page=post&s=view&id=") || location.href.includes("page=post&s=list&tags=all")) {
                    if (indicator) indicator.style.display = 'none';
                    return;
                }
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.id = 'page-indicator';
                    document.body.appendChild(indicator);
                }
                if (typeof InfiniteScrollAPI !== 'undefined' && InfiniteScrollAPI.isActive()) {
                    const apiState = InfiniteScrollAPI.getState();
                    if (apiState && apiState.totalPostCount) {
                        setTotalPostCount(apiState.totalPostCount, apiState.perPage || getPerPage());
                    }
                }
                if (!location.href.includes('#')) totalPages = null;
                updateDisplay();
            } catch (e) {
                console.debug('[PageIndicator] Fehler:', e);
            }
        };

        fn.setTotalPages = setTotalPages;
        fn.setTotalPostCount = setTotalPostCount;
        fn.update = updateDisplay;
        fn.hide = () => { if (indicator) indicator.style.display = 'none'; };
        fn.show = () => { if (indicator) indicator.style.display = 'block'; };
        return fn;
    })();

    // --- USER INTERFACE (MOUSE & UI PANELS) ---
    const setupFavoriteOnHover = () => {
        let hoveredElement = null;
        document.addEventListener('mouseenter', e => { hoveredElement = e.target; }, { passive: true, capture: true });
        document.addEventListener('mouseleave', e => { if (e.target === hoveredElement) hoveredElement = null; }, { capture: true });
        window.addEventListener('pointerdown', e => {
            if (e.button !== 3) return;
            const active = document.activeElement;
            if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
            const link = hoveredElement?.closest('a[href*="id="], a[id^="p"]');
            const postId = link ? (new URL(link.href, location.href).searchParams.get('id') || link.id.slice(1)) : new URLSearchParams(location.search).get('id');
            if (postId && typeof unsafeWindow.addFav === 'function') unsafeWindow.addFav(postId);
        }, true);
    };

    const setupCollapsibleHeader = () => {
        const header = document.querySelector('#header');
        if (!header || location.href.includes('page=favorites&s=view&id=')) return;
        let expandTimeout, collapseTimeout;
        let isFixed = localStorage.getItem('r34_header_fixed') === 'true';
        let fixButton = header.querySelector('.header-fix-btn');
        if (!fixButton) {
            fixButton = document.createElement('button');
            fixButton.className = 'header-fix-btn';
            header.appendChild(fixButton);
        }
        const updateState = () => {
            header.style.height = isFixed ? 'auto' : '40px';
            fixButton.textContent = isFixed ? '❌ Unpin' : '📌 Pin';
        };
        const toggleFixed = () => { isFixed = !isFixed; localStorage.setItem('r34_header_fixed', isFixed); updateState(); };
        fixButton.addEventListener('click', toggleFixed);
        header.addEventListener('mouseenter', () => { if (!isFixed) { clearTimeout(collapseTimeout); expandTimeout = setTimeout(() => header.style.height = 'auto', CONSTANTS.HEADER_EXPAND_DELAY_MS); } });
        header.addEventListener('mouseleave', () => { if (!isFixed) { clearTimeout(expandTimeout); collapseTimeout = setTimeout(() => header.style.height = CONSTANTS.HEADER_COLLAPSED_HEIGHT, CONSTANTS.HEADER_COLLAPSE_DELAY_MS); } });
        document.addEventListener('keydown', e => (e.altKey && e.key.toLowerCase() === 'h') && toggleFixed());
        updateState();
    };

    const setupControlPanel = () => {
        let savedPos = JSON.parse(localStorage.getItem('r34_button_pos')) || { top: -1, left: 162 };
        let isVisible = localStorage.getItem('r34_button_visible') !== 'false';
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = '⚙️ r34 Panel';
        toggleBtn.className = 'r34-panel-btn';
        Object.assign(toggleBtn.style, { top: `${savedPos.top}px`, left: `${savedPos.left}px` });
        const panel = document.createElement('div');
        panel.className = 'r34-panel';

        const form = document.createElement('form');
        const groupedFeatures = {
            'Core': ['favoriteOnMouse', 'removeDuplicates', 'removeAnnoyances', 'fixPaginatorLinks', 'removePidParameter', 'restoreDeletedPost'],
            'Performance': ['nativeLazyLoading', 'apiInfiniteScroll', 'advancedImageLoading'],
            'Visual': ['collapsibleHeader', 'hideBlacklisted', 'hideEmptyThumbSpans', 'faviconChanger', 'pageIndicator', 'removeThumbTitles']
        };
        const descriptions = {
            favoriteOnMouse: 'Aktiviert Favorisieren mit Mausrad-Klick',
            removeDuplicates: 'Entfernt doppelte Thumbnails auf der Seite',
            removeAnnoyances: 'Entfernt Werbung und störende Elemente',
            fixPaginatorLinks: 'Repariert defekte Paginierungs-Links',
            removePidParameter: 'Entfernt unnötige PID-Parameter aus URLs',
            restoreDeletedPost: 'Stellt gelöschte Posts über die API wieder her',
            nativeLazyLoading: 'Aktiviert natives Lazy Loading für Bilder',
            apiInfiniteScroll: 'API-basiertes Scrollen (reduziert Captchas)',
            advancedImageLoading: 'Intelligentes Bild-Laden mit Priorisierung',
            collapsibleHeader: 'Header klappt automatisch ein/aus',
            hideBlacklisted: 'Versteckt geblacklistete Inhalte',
            hideEmptyThumbSpans: 'Entfernt leere Thumbnail-Container',
            faviconChanger: 'Ändert das Favicon je nach Seite',
            pageIndicator: 'Zeigt aktuelle Seitennummer an',
            removeThumbTitles: 'Entfernt Tooltips von Thumbnails'
        };

        Object.entries(groupedFeatures).forEach(([group, keys]) => {
            let sectionHtml = `<strong>${group}</strong>`;
            keys.forEach(key => {
                sectionHtml += `<label><input type="checkbox" name="${key}" ${CONFIG[key] ? 'checked' : ''}> ${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}`;
                if (descriptions[key]) sectionHtml += `<span class="tooltip-info" title="${descriptions[key]}"> ℹ️</span>`;
                sectionHtml += `</label>`;
            });
            form.insertAdjacentHTML('beforeend', sectionHtml);
        });

        form.insertAdjacentHTML('beforeend', `<div><button type="submit" class="save-btn">💾 Save & Reload</button><button type="button" class="cancel-btn">❌ Cancel</button><button type="button" class="reset-btn">🔁 Reset Defaults</button><button type="button" class="export-btn">📤 Export</button><button type="button" class="import-btn">📥 Import</button></div>`);
        panel.appendChild(form);

        let isMinimized = false;
        const minimizeBtn = document.createElement('button');
        minimizeBtn.textContent = '−';
        minimizeBtn.className = 'minimize-btn';
        minimizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isMinimized = !isMinimized;
            form.style.display = isMinimized ? 'none' : 'block';
            minimizeBtn.textContent = isMinimized ? '+' : '−';
            panel.style.height = isMinimized ? 'auto' : '';
        });
        panel.insertBefore(minimizeBtn, form);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const newConfig = {};
            Object.keys(DEFAULT_CONFIG).forEach(key => newConfig[key] = formData.has(key));
            localStorage.setItem('r34_feature_flags', JSON.stringify(newConfig));
            location.reload();
        });
        form.querySelector('.cancel-btn').addEventListener('click', () => panel.style.display = 'none');
        form.querySelector('.reset-btn').addEventListener('click', () => { localStorage.setItem('r34_feature_flags', JSON.stringify(DEFAULT_CONFIG)); location.reload(); });
        form.querySelector('.export-btn').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(localStorage.getItem('r34_feature_flags') || JSON.stringify(DEFAULT_CONFIG));
                alert('Config copied to clipboard.');
            } catch (e) { alert('Unable to copy config.'); }
        });
        form.querySelector('.import-btn').addEventListener('click', () => {
            try {
                const text = prompt('Paste config JSON here:');
                if (!text) return;
                JSON.parse(text);
                localStorage.setItem('r34_feature_flags', text);
                alert('Imported. Reloading.');
                location.reload();
            } catch (e) { alert('Invalid JSON.'); }
        });

        toggleBtn.addEventListener('click', () => {
            const rect = toggleBtn.getBoundingClientRect();
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.bottom + window.scrollY + 5}px`;
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });
        toggleBtn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            const shiftX = e.clientX - toggleBtn.getBoundingClientRect().left;
            const shiftY = e.clientY - toggleBtn.getBoundingClientRect().top;
            const moveAt = (pageX, pageY) => {
                toggleBtn.style.left = `${pageX - shiftX}px`;
                toggleBtn.style.top = `${pageY - shiftY}px`;
            };
            const onMouseMove = e => moveAt(e.pageX, e.pageY);
            document.addEventListener('mousemove', onMouseMove);
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                localStorage.setItem('r34_button_pos', JSON.stringify({ top: parseInt(toggleBtn.style.top, 10) || 0, left: parseInt(toggleBtn.style.left, 10) || 0 }));
                document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mouseup', onMouseUp);
        });
        toggleBtn.ondragstart = () => false;

        document.addEventListener('keydown', e => {
            if (e.altKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                const isNowVisible = document.body.contains(toggleBtn);
                if (isNowVisible) {
                    toggleBtn.remove();
                    panel.remove();
                    localStorage.setItem('r34_button_visible', 'false');
                } else {
                    document.body.appendChild(toggleBtn);
                    document.body.appendChild(panel);
                    localStorage.setItem('r34_button_visible', 'true');
                }
            }
        });

        if (isVisible) {
            document.body.appendChild(toggleBtn);
            document.body.appendChild(panel);
        }
    };

    // --- CLEANUP FUNKTION ---
    const cleanup = () => {
        observers.forEach(obs => {
            try { obs.disconnect(); } catch (e) { console.debug('Observer disconnect failed:', e); }
        });
        observers = [];
        SmartImageLoader.clear();
    };

    // --- MAIN INITIALIZATION & OBSERVER ---
    const init = async () => {
        performanceMonitor.start('totalInit');

        // Expose CONFIG global für SmartImageLoader
        window.CONFIG = CONFIG;

        await handleOptionsPage();
        let canRestore = false;
        if (CONFIG.restoreDeletedPost) canRestore = await checkApiKey();
        if (CONFIG.favoriteOnMouse) setupFavoriteOnHover();
        if (CONFIG.collapsibleHeader) setupCollapsibleHeader();
        setupControlPanel();
        if (CONFIG.restoreDeletedPost && canRestore && window.location.href.includes('page=post&s=view')) setTimeout(restoreDeletedPost, 500);

        if (CONFIG.apiInfiniteScroll && InfiniteScrollAPI.init()) {
            console.log('[Userscript] API-basiertes Infinite Scrolling aktiviert.');
            const pagetualNext = document.querySelector('.pagination a[alt="next"]');
            if (pagetualNext) pagetualNext.style.display = 'none';
        }

        const runAll = (contexts = [document]) => {
            performanceMonitor.start('runAll');
            contexts.forEach(ctx => {
                if (CONFIG.hideBlacklisted) hideBlacklisted(ctx);
                if (CONFIG.removeDuplicates) removeDuplicateThumbnails(ctx);
                if (CONFIG.removeAnnoyances) removeAnnoyances(ctx);
                if (CONFIG.fixPaginatorLinks) fixPaginatorLinks(ctx);
                if (CONFIG.removePidParameter) removePidParameter(ctx);
                if (CONFIG.nativeLazyLoading) setNativeLazyLoading(ctx);
                if (CONFIG.hideEmptyThumbSpans) hideEmptyThumbSpans(ctx);
                if (CONFIG.removeThumbTitles) removeThumbTitle(ctx);
            });
            performanceMonitor.end('runAll');
        };

        runAll();
        if (CONFIG.pageIndicator) updatePageIndicator();
        if (CONFIG.faviconChanger) updateFavicon();

        const addedNodesBuffer = new Set();
        const processAddedNodes = debounce(() => {
            if (addedNodesBuffer.size === 0) return;
            performanceMonitor.start('processAddedNodes');
            runAll(Array.from(addedNodesBuffer));
            addedNodesBuffer.clear();
            performanceMonitor.end('processAddedNodes');
        }, CONSTANTS.DEBOUNCE_MUTATION_MS);

        const observer = new MutationObserver((mutations) => {
            let needsUpdate = false;
            for (const m of mutations) {
                for (const n of m.addedNodes) {
                    if (n.nodeType === 1) {
                        if (n.id === 'content') {
                            addedNodesBuffer.clear();
                            addedNodesBuffer.add(n);
                            needsUpdate = true;
                            break;
                        }
                        const hasThumb = n.matches?.('.thumb') ||
                            n.classList?.contains('image-list') ||
                            (n.querySelector && n.querySelector('.thumb'));
                        if (hasThumb) { addedNodesBuffer.add(n); needsUpdate = true; }
                    }
                }
            }
            if (needsUpdate) processAddedNodes();
        });
        observers.push(observer);
        observer.observe(document.body, { childList: true, subtree: true });

        let lastHref = location.href;
        const handleUrlChangeImmediate = () => {
            const newUrl = location.href;
            if (newUrl === lastHref) return;
            const oldPath = new URL(lastHref).pathname;
            const newPath = new URL(newUrl).pathname;
            const isPageChange = oldPath !== newPath;
            lastHref = newUrl;
            performanceMonitor.start('urlChange');
            if (isPageChange) {
                if (CONFIG.removeDuplicates && typeof removeDuplicateThumbnails.reset === 'function') removeDuplicateThumbnails.reset();
                if (CONFIG.faviconChanger) updateFavicon();
                if (CONFIG.pageIndicator) updatePageIndicator();
                if (CONFIG.restoreDeletedPost && canRestore && newUrl.includes('page=post&s=view')) restoreDeletedPost();
                runAll();
            } else {
                if (CONFIG.removeDuplicates && typeof removeDuplicateThumbnails.reset === 'function') removeDuplicateThumbnails.reset();
            }
            performanceMonitor.end('urlChange');
        };

        const debouncedHeadObserver = debounce(handleUrlChangeImmediate, CONSTANTS.DEBOUNCE_URL_MS);
        const headObserver = new MutationObserver(debouncedHeadObserver);
        observers.push(headObserver);
        headObserver.observe(document.head || document.documentElement, { childList: true, subtree: true });

        window.addEventListener('popstate', handleUrlChangeImmediate);
        window.addEventListener('pushstate', handleUrlChangeImmediate);
        window.addEventListener('replacestate', handleUrlChangeImmediate);
        window.addEventListener('beforeunload', cleanup);

        const wrapHistoryMethod = (type) => {
            const orig = history[type];
            return function() {
                const rv = orig.apply(this, arguments);
                window.dispatchEvent(new Event(type.toLowerCase()));
                return rv;
            };
        };
        history.pushState = wrapHistoryMethod('pushState');
        history.replaceState = wrapHistoryMethod('replaceState');

        performanceMonitor.end('totalInit');
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();