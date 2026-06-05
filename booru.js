// ==UserScript==
// @name        Booru++ Custom Enhancer V4.5 (API Edition)
// @namespace   -
// @version     4.5.1
// @icon        https://i.imgur.com/m2kIFiy.png
// @description FastView mit direkter API-Nutzung für Source-Bilder
// @author      jAstn
// @match       https://rule34.xxx/*
// @connect     api.rule34.xxx
// @connect     rule34.xxx
// @connect     wimg.rule34.xxx
// @connect     api-cdn.rule34.xxx
// @license     GPL-3.0-or-later
// @grant       GM_addStyle
// @grant       GM_xmlhttpRequest
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const config = {
        hosts: {
            "rule34.xxx": {
                accentColor: "rgb(147, 195, 147)",
                selectors: {
                    content: "#content, #static-index, #page, #container",
                    thumb: ".post-preview:not([data-tags*='video']) img, .thumbnail-preview img, .preview, .image-list, img",
                    firstPosts: ":where(.thumb, article.post-preview, .thumbnail-preview):not(:where(:nth-child(3) ~ *))",
                    tags: "[class*='tag-type'] a:not([href*='://']), .search-tag",
                    paginator: "#paginator, .paginator",
                    pages: "#paginator a, .paginator .numbered-page a, .arrow a",
                    postList: "#post-list, #c-posts, .thumbnail-container, .image-list, #favorites-search-gallery-content, #content",
                },
            },
        },
    };

    const API_KEY = 'df635ee14f0702f7ec17ca9cc26c866cdcb1b7cec6a83797abb9b36a75324b1085aea48d4f6dafec920719e053dd856e9e0ad1bb667872146e06d97c36c53e0f';
    const USER_ID = '5598646';

    const currentHost = config.hosts[location.host] || {};
    const selectors = currentHost.selectors || {};

    // Cache zum Speichern von URLs, um doppelte Anfragen zu verhindern
    const mediaCache = new Map();

    const getAccentColor = () => currentHost.accentColor || "rgb(200, 200, 200)";
    const getStylesheet = () => `
    :root {
      --accent: ${getAccentColor()};
    }
    .loading::before {
      content: '';
      width: 50px;
      height: 50px;
      display: block;
      border-radius: 50%;
      border: 10px solid rgb(255, 255, 255);
      border-top: var(--accent) 10px solid;
      position: fixed;
      animation: 1s infinite loading-ani;
      left: calc(50% - 25px);
      top: calc(50% - 25px);
      z-index: 2147483646;
    }
    .loading {
      opacity: 0.65;
    }
    .image-view {
      position: fixed;
      left: 0;
      top: 0;
      transition: opacity;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.7);
      z-index: 100;
    }
    .image-view img {
      max-height: 100%;
      max-width: 100%;
      margin: auto;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.1);
      -webkit-user-drag: none;
    }
    .image-view .close-button {
      position: fixed;
      top: 10px;
      right: 10px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      z-index: 101;
    }
    .image-view .close-button::before, .image-view .close-button::after {
      content: '';
      position: absolute;
      width: 100%;
      height: 3px;
      background-color: white;
      top: 50%;
      left: 0;
      transform: rotate(45deg);
    }
    .image-view .close-button::after {
      transform: rotate(-45deg);
    }
    @keyframes loading-ani {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;

    const addStylesheet = (css) => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
    };

    const setVisibility = (el, isVisible) => {
        el.style.opacity = isVisible ? "1" : "0";
        el.style.pointerEvents = isVisible ? "auto" : "none";
    };

    // Generische Fetch-Funktion
    const smartFetch = (url, isJson = false) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            if (isJson) {
                                resolve(JSON.parse(response.responseText));
                            } else {
                                const parser = new DOMParser();
                                resolve(parser.parseFromString(response.responseText, "text/html"));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: (err) => {
                    console.error("GM_xmlhttpRequest Error:", err);
                    reject(err);
                }
            });
        });
    };

    // Hilfsfunktion: URL des Bildes/Videos ermitteln (API first, Fallback auf HTML)
    const getMediaSource = async (pageUrl) => {
        try {
            // 1. Post-ID aus der Link-URL extrahieren
            const urlObj = new URL(pageUrl, window.location.origin);
            const postId = urlObj.searchParams.get("id");

            if (postId) {
                // Wenn die URL schon im Cache liegt, direkt laden
                if (mediaCache.has(postId)) {
                    return mediaCache.get(postId);
                }

                try {
                    // 2. Direkte API Abfrage starten
                    const apiUrl = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&id=${postId}&json=1&api_key=${API_KEY}&user_id=${USER_ID}`;
                    const jsonResponse = await smartFetch(apiUrl, true);

                    if (jsonResponse && jsonResponse.length > 0) {
                        let fileUrl = jsonResponse[0].file_url;

                        // Fallback: Optional api-cdn mit wimg ersetzen (kann einkommentiert werden, falls api-cdn Probleme macht)
                        // fileUrl = fileUrl.replace("api-cdn.rule34.xxx", "wimg.rule34.xxx");

                        // Prüfen ob es sich um ein Video handelt
                        const isVideo = fileUrl.match(/\.(mp4|webm|mov)$/i) !== null;

                        const mediaInfo = {
                            src: fileUrl,
                            type: isVideo ? "video" : "image"
                        };

                        // Ergebnis im Cache speichern
                        mediaCache.set(postId, mediaInfo);
                        return mediaInfo;
                    }
                } catch (apiErr) {
                    console.warn("API Request fehlgeschlagen, versuche HTML-Fallback...", apiErr);
                }
            }

            // 3. Fallback: Seite im Hintergrund abrufen (falls API ausfällt)
            const response = await fetch(pageUrl);
            const html = await response.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const highResElement = doc.querySelector('#image') || doc.querySelector('#gelbooru-video source');

            if (highResElement) {
                const isVideo = highResElement.tagName === 'SOURCE' || highResElement.src.endsWith('.mp4');
                const mediaInfo = {
                    src: highResElement.src,
                    type: isVideo ? "video" : "image"
                };
                if (postId) mediaCache.set(postId, mediaInfo);
                return mediaInfo;
            }

            const metaImg = doc.querySelector('meta[property="og:image"]');
            if (metaImg) {
                const mediaInfo = { src: metaImg.content, type: "image" };
                if (postId) mediaCache.set(postId, mediaInfo);
                return mediaInfo;
            }

            return null;
        } catch (err) {
            console.error("FastView Fetch Error:", err);
            return null;
        }
    };

    const initFastImageView = (postList, content) => {
        const fastViewEl = document.createElement("div");
        fastViewEl.className = "image-view";

        const closeButton = document.createElement("div");
        closeButton.className = "close-button";

        let currentMedia = null;
        let isLoading = false;
        let lastClick = 0;
        const cooldown = 150;

        // Variablen für ScrollAnywhere Fix
        let startX = 0;
        let startY = 0;
        let isRightClickHeld = false;
        const dragTolerance = 15;

        fastViewEl.appendChild(closeButton);
        content.appendChild(fastViewEl);
        setVisibility(fastViewEl, false);

        const openMedia = async (link) => {
            if (isLoading) return;
            isLoading = true;
          /*  document.body.classList.add("loading"); */

            try {
                const mediaInfo = await getMediaSource(link.href);

                if (!mediaInfo) {
                    throw new Error("No media found");
                }

                if (currentMedia) {
                    currentMedia.remove();
                    currentMedia = null;
                }

                if (mediaInfo.type === "image") {
                    const imgEl = document.createElement("img");
                    imgEl.src = mediaInfo.src;

                    // Fallback, falls api-cdn das Bild nicht lädt -> wechsel zu wimg
                    imgEl.onerror = () => {
                        if (imgEl.src.includes("api-cdn.rule34.xxx")) {
                            console.log("Wechsle zu wimg Fallback...");
                            imgEl.src = imgEl.src.replace("api-cdn.rule34.xxx", "wimg.rule34.xxx");
                        }
                    };

                    currentMedia = imgEl;
                } else if (mediaInfo.type === "video") {
                    const videoEl = document.createElement("video");
                    videoEl.src = mediaInfo.src;
                    videoEl.controls = true;
                    videoEl.autoplay = true;
                    videoEl.loop = true;
                    videoEl.volume = 0.3;
                    videoEl.style.maxWidth = "100%";
                    videoEl.style.maxHeight = "100%";
                    videoEl.style.position = "absolute";
                    videoEl.style.top = "0";
                    videoEl.style.bottom = "0";
                    videoEl.style.left = "0";
                    videoEl.style.right = "0";
                    videoEl.style.margin = "auto";
                    currentMedia = videoEl;
                }

                if (currentMedia) {
                    fastViewEl.insertBefore(currentMedia, closeButton);
                    setVisibility(fastViewEl, true);
                }
            } catch (err) {
                console.error("Error in openMedia:", err);
            } finally {
                isLoading = false;
               /* document.body.classList.remove("loading"); */
            }
        };

        // ScrollAnywhere Logic Starts here
        postList.addEventListener("mousedown", (e) => {
            if (e.button === 2) {
                let thumb = e.target.closest(selectors.thumb);
                if (thumb && postList.contains(thumb)) {
                    isRightClickHeld = true;
                    startX = e.clientX;
                    startY = e.clientY;
                }
            }
        });

        postList.addEventListener("mouseup", (e) => {
            if (e.button === 2 && isRightClickHeld) {
                isRightClickHeld = false;

                let thumb = e.target.closest(selectors.thumb);
                if (!thumb) return;

                const link = thumb.closest("a");
                if (!link) return;

                const diffX = Math.abs(e.clientX - startX);
                const diffY = Math.abs(e.clientY - startY);

                if (diffX < dragTolerance && diffY < dragTolerance) {
                    e.stopPropagation();
                    const now = Date.now();
                    if (now - lastClick >= cooldown) {
                        lastClick = now;
                        openMedia(link);
                    }
                }
            }
        });

        postList.addEventListener("contextmenu", (e) => {
            let thumb = e.target.closest(selectors.thumb);
            if (!thumb) return;

            const diffX = Math.abs(e.clientX - startX);
            const diffY = Math.abs(e.clientY - startY);

            if (diffX < dragTolerance && diffY < dragTolerance) {
                e.preventDefault();
            }
        });
        // ScrollAnywhere Logic Ends here

        const closeViewer = () => {
            setVisibility(fastViewEl, false);
            if (currentMedia) {
                if (currentMedia.tagName === "IMG") {
                    currentMedia.src = "";
                } else if (currentMedia.tagName === "VIDEO") {
                    currentMedia.pause();
                    currentMedia.src = "";
                    currentMedia.load();
                }
                currentMedia.remove();
                currentMedia = null;
            }
        };

        closeButton.addEventListener("click", closeViewer);

        fastViewEl.addEventListener("mousedown", (e) => {
            if (e.button !== 2) return;
            setTimeout(() => {
                closeViewer();
            }, 150);
        });

        fastViewEl.addEventListener("wheel", (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });

        fastViewEl.addEventListener("click", (e) => {
            if (
                e.target === fastViewEl ||
                (currentMedia && currentMedia.tagName === "IMG" && currentMedia.contains(e.target))
            ) {
                setTimeout(() => {
                    closeViewer();
                }, 150);
            }
        }, { passive: true });
    };

    const init = async () => {
        addStylesheet(getStylesheet());
        const content = document.querySelector(selectors.content);
        const postList = document.querySelector('.image-list') ||
              document.querySelector('#favorites-search-gallery-content') ||
              document.querySelector('.thumbnail-container') ||
              document.body;

        if (postList) {
            initFastImageView(postList, content);
        }
        if (!content) return;
    };

    init();
})();