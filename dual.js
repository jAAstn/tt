// ==UserScript==
// @name        Image Board Enhancer Dual [Selber]
// @description Auto Resize images and video on multiple image boards and enlarges thumbnails on mouse hover and adds content type icons to them. Added Header Color Validation & Fixes.
// @author      me (Optimized by Senior JS Developer)
// @version     1.6.1
// @match       *://rule34.xxx/*
// @require     https://ajax.googleapis.com/ajax/libs/jquery/3.2.1/jquery.min.js
// @grant       GM.setValue
// @grant       GM.getValue
// @icon        https://i.imgur.com/sUsekOa.png
// @run-at      document-body
// ==/UserScript==

(async () => {
    'use strict';

    var resizeImageToFit = await GM.getValue('resizeImageToFit', true);
    var resizeVideoToFit = await GM.getValue('resizeVideoToFit', true);
    var autoplayVideos = await GM.getValue('autoplayVideos', true);
    var autoScrollToContent = await GM.getValue('autoScrollToContent', true);
    var updateWithWindowResize = await GM.getValue('updateWithWindowResize', false);
    var updateScrollOnWindowResize = await GM.getValue('updateScrollOnWindowResize', false);
    var showFitButton = await GM.getValue('showFitButton', false);
    var showScrollButton = await GM.getValue('showScrollButton', false);
    var removeFluid = await GM.getValue('removeFluid', false);
    var videoVolume = await GM.getValue('videoVolume', 0);
    var alwaysShowScrollbars = await GM.getValue('alwaysShowScrollbars', false);
    var resizeButton = await GM.getValue('resizeButton', 'BracketLeft');
    var scrollButton = await GM.getValue('scrollButton', 'BracketRight');
    var showFavoriteTags = await GM.getValue('showFavoriteTags', { draw: true, open: false });
    var favoriteTags = await GM.getValue('favoriteTags', {});
    var showFavoriteTagsUSER = await GM.getValue('showFavoriteTagsUSER', { draw: true, open: false });
    var favoriteTagsUSER = await GM.getValue('favoriteTagsUSER', {});

    var tagDB = await GM.getValue('tagDB', {});
    var customSites = await GM.getValue('customSites', {});

    // Create variables. DO NOT CHANGE!
    var currentWindowWidth = 0;
    var currentWindowHeight = 0;
    var currentWindowAspect = 0;
    var contentTrueWidth = 0;
    var contentTrueHeight = 0;
    var contentTrueAspect = 0;
    var resizeReady = false;
    var toolbarDOM = '.sidebar form';
    var containerDOM = '#content';
    var imageDOM = '#image';
    var playerDOM;
    var changeKeyboardShortcut = false;
    var containerAlignment = '';
    var thumbnailDOM = '.thumb';
    var thumbnails = [];
    var animationTagIsGif = false;
    var urlParams = new URLSearchParams(window.location.search);
    var waitingForZoom = false;
    var wzoom;
    var placeSettingsAfter = true;
    var loggedin = false;
    var thumbDetailsOpen = false;
    var tagSearchLink = '/index.php?page=post&s=list&tags=';
    var tagSearchLinkafter = '';
    var removeFavorite = () => { };
    var currentImageThumb = '';
    var tagSplit = ' ';
    var tagsHaveUnderscores = true;
    var tagsURLParam = 'tags';
    var site = document.location.hostname.toLowerCase().replace('www.', '');
    var siteUsesInfScroll = false;

    // Debug stuff.
    var debugMode = false;
    var keepThumbOpen = false;
    if (debugMode) var lastVersion = 0;

    function configureSites() {
        if (debugMode) console.log('Function: configureSites');
        if (site == 'rule34.xxx') { toolbarDOM = '.sidebar > div'; playerDOM = '#gelcomVideoContainer'; animationTagIsGif = true; loggedin = true; }
        else if (customSites[site]) {
            var obj = customSites[site];
            if (obj.toolbarDOM) toolbarDOM = obj.toolbarDOM;
            $("body").append("<button id='ibenhancerDeleteConfigButton' style='position: absolute; top: 0px; right: 0px; z-index: 9999999; color: black; background-color: whitesmoke; font-size: 12px;'>Delete site config.</button>");
            $("#ibenhancerDeleteConfigButton").click(deleteSiteConfig);
        }
        else {
            $("body").append("<button id='ibenhancerSetupButton' style='position: absolute; top: 0px; right: 0px; z-index: 9999999; color: black; background-color: whitesmoke; font-size: 12px;'>Setup Image Board Enhancer</button>");
            $("#ibenhancerSetupButton").click(addSiteConfig);
            console.warn('This site is not supported, but may still work.');
        }
    }

    function addSiteConfig() {
        var config = JSON.parse(prompt("Enter config in JSON format.", '{"toolbarDOM": ".sidebar form", "containerDOM": "#content", "imageDOM": "#image", "thumbnailDOM": ".thumb" }'));
        if (config === null || !config || config == {}) {
            alert('Config not valid.');
        } else {
            customSites[site] = config;
            GM.setValue('customSites', customSites);
            alert('Config saved.');
            location.reload();
        }
    }

    function deleteSiteConfig() {
        delete customSites[site];
        GM.setValue('customSites', customSites);
        alert('Config deleted.');
        location.reload();
    }

    function removeFluidPlayer() {
        $(playerDOM).replaceWith("<video src='" + ($(containerDOM + ' video').attr('src') || $(containerDOM + ' video source').attr('src')) + "' controls='true' />");
    }

    function getWindowProps() {
        currentWindowWidth = document.documentElement.clientWidth;
        currentWindowHeight = document.documentElement.clientHeight;
        var sidebar = $('.sidebar, #tag-sidebar');
        if (sidebar.length && sidebar.is(':visible')) {
            currentWindowWidth = currentWindowWidth - sidebar.outerWidth(true) - 20;
        }
        if (currentWindowWidth !== 0 && currentWindowHeight !== 0)
            currentWindowAspect = currentWindowWidth / currentWindowHeight;
    }

    function getContentProps() {
        if ($(containerDOM + ' ' + imageDOM).length) {
            var screenImage = $(containerDOM + ' ' + imageDOM);
            if (screenImage[0].videoWidth) {
                contentTrueWidth = screenImage[0].videoWidth;
                contentTrueHeight = screenImage[0].videoHeight;
            } else {
                var theImage = new Image();
                theImage.src = screenImage.attr("src");
                contentTrueWidth = theImage.width;
                contentTrueHeight = theImage.height;
            }
        }
        else if ($(containerDOM + ' video').length) {
            contentTrueWidth = $(containerDOM + ' video')[0].videoWidth;
            contentTrueHeight = $(containerDOM + ' video')[0].videoHeight;
        }

        if (contentTrueWidth !== 0 && contentTrueHeight !== 0)
            contentTrueAspect = contentTrueWidth / contentTrueHeight;
        resizeReady = true;
    }

    function resizeImage() {
        $(containerDOM + ' ' + imageDOM).css('max-width', '');
        if (currentWindowAspect > contentTrueAspect) {
            $(containerDOM + ' ' + imageDOM)[0].width = currentWindowHeight * contentTrueAspect;
            $(containerDOM + ' ' + imageDOM)[0].height = currentWindowHeight;
        } else {
            $(containerDOM + ' ' + imageDOM)[0].width = currentWindowWidth;
            $(containerDOM + ' ' + imageDOM)[0].height = currentWindowWidth / contentTrueAspect;
        }
        $(containerDOM + ' ' + imageDOM).removeAttr('style');
    }

    // ==== Hier ist die geprüfte resizeFluidVideo Funktion ====
    function resizeFluidVideo() {
        $(containerDOM + ' ' + playerDOM).css('max-width', '');

        if (currentWindowAspect > contentTrueAspect) {
            $(containerDOM + ' ' + playerDOM).css('width', currentWindowHeight * contentTrueAspect);
            $(containerDOM + ' ' + playerDOM).css('height', currentWindowHeight);
        } else {
            $(containerDOM + ' ' + playerDOM).css('width', currentWindowWidth);
            $(containerDOM + ' ' + playerDOM).css('height', currentWindowWidth / contentTrueAspect);
        }
    }

    // ==== Direkt darunter die gefixte resizeVideo Funktion ====
    function resizeVideo() {
        $(containerDOM + ' video').css('max-width', '');

        if (currentWindowAspect > contentTrueAspect) {
            $(containerDOM + ' video')[0].width = currentWindowHeight * contentTrueAspect;
            $(containerDOM + ' video')[0].height = currentWindowHeight;
        } else {
            $(containerDOM + ' video')[0].width = currentWindowWidth;
            $(containerDOM + ' video')[0].height = currentWindowWidth / contentTrueAspect; // FIX: [0] hinzugefügt
        }
    }

    function scrollToContent(delay) {
        setTimeout(function () {
            var contentID;
            if ($(containerDOM + ' ' + imageDOM).length) contentID = containerDOM + ' ' + imageDOM;
            else if ($(containerDOM + ' ' + playerDOM).length) contentID = containerDOM + ' ' + playerDOM;
            else if ($(containerDOM + ' video').length) contentID = containerDOM + ' video';

            $([document.documentElement, document.body]).animate({ scrollTop: $(contentID).offset().top + 1 }, 0);
            $([document.documentElement, document.body]).animate({ scrollLeft: $(contentID).offset().right + 1 }, 0);
        }, delay);
    }

    function fitContent(delay) {
        setTimeout(function () {
            if (resizeReady) {
                getWindowProps();
                if ($(containerDOM + ' ' + imageDOM).length) { resizeImage(); }
                else if ($(containerDOM + ' ' + playerDOM).length) { resizeFluidVideo(); }
                else if ($(containerDOM + ' video').length) { resizeVideo(); }
            }
        }, delay);
    }

    function enhanceContent() {
        if(site == 'gelbooru.com') $('video:not([id])').remove();
        if (removeFluid && $(playerDOM).length) removeFluidPlayer();

        if ($(containerDOM + ' video').length || $(containerDOM + ' ' + imageDOM).length) {
            if (alwaysShowScrollbars) $('html').css({ overflow: 'scroll' });
            getContentProps();
            if (resizeImageToFit) fitContent(0);
            if (autoScrollToContent) {
                scrollToContent(0);
                var firstRun = true;
                $(window).focus(function () {
                    if (firstRun) { scrollToContent(0); firstRun = false; }
                });
            }
        }

        if ($(containerDOM + ' video').length) {
            $(containerDOM + ' video').prop('autoplay', autoplayVideos);
            $(containerDOM + ' video').prop('volume', videoVolume);
            $(containerDOM + ' video').prop('loop', true);
            if (autoplayVideos) $(containerDOM + ' video')[0].play(); else $(containerDOM + ' video')[0].pause();

            $(containerDOM + ' video').on('loadedmetadata', function () {
                getContentProps();
                if (resizeVideoToFit) fitContent(200);
                if (autoScrollToContent) scrollToContent(200);
                $(containerDOM + ' video').play();
            });
        }
        else if ($(containerDOM + ' ' + imageDOM).length) {
            $(containerDOM + ' ' + imageDOM).on('load', function () {
                if (waitingForZoom) { setTimeout(openZoom, 16); waitingForZoom = false; }
                getContentProps();
                if (resizeImageToFit) fitContent(200);
                if (autoScrollToContent) scrollToContent(200);
            });
        }
    }

    function addWindowEvents() {
        if (updateWithWindowResize) {
            $(window).resize(function () {
                fitContent(0);
                if (updateScrollOnWindowResize) scrollToContent(0);
            });
        }
    }

    function showSettings() {
        $("#ibenhancerSettings").addClass('show');
        $("#ibenhancerSettings-blocker").addClass('show');
        $("html").addClass('ibenhancerSettingVisible');
    }

    function hideSettings() {
        $("#ibenhancerSettings").removeClass('show');
        $("#ibenhancerSettings-blocker").removeClass('show');
        $("html").removeClass('ibenhancerSettingVisible');
        $("#resizeImageToFitCheckbox").prop('checked', resizeImageToFit);
        $("#resizeVideoToFitCheckbox").prop('checked', resizeVideoToFit);
        $("#autoplayVideosCheckbox").prop('checked', autoplayVideos);
        $("#autoScrollToContentCheckbox").prop('checked', autoScrollToContent);
        $("#updateWithWindowResizeCheckbox").prop('checked', updateWithWindowResize);
        $("#updateScrollOnWindowResizeCheckbox").prop('checked', updateScrollOnWindowResize);
        $("#removeFluidCheckbox").prop('checked', removeFluid);
        $("#alwaysShowScrollbarsCheckbox").prop('checked', alwaysShowScrollbars);
        $("#showFavoriteTagsCheckbox").prop('checked', showFavoriteTags['draw']);
        $("#videoVolumeInput").val(videoVolume);
    }

    function changeButtonClicked(buttonType) {
        if (buttonType === 'resize') { $('#resizeButton').html('?'); changeKeyboardShortcut = 'resizeButton'; }
        else if (buttonType === 'scroll') { $('#scrollButton').html('?'); changeKeyboardShortcut = 'scrollButton'; }
    }

    function saveSettings() {
        GM.setValue('resizeImageToFit', $('#resizeImageToFitCheckbox').is(':checked'));
        GM.setValue('resizeVideoToFit', $('#resizeVideoToFitCheckbox').is(':checked'));
        GM.setValue('autoplayVideos', $('#autoplayVideosCheckbox').is(':checked'));
        GM.setValue('autoScrollToContent', $('#autoScrollToContentCheckbox').is(':checked'));
        GM.setValue('removeFluid', $('#removeFluidCheckbox').is(':checked'));
        GM.setValue('videoVolume', $('#videoVolumeInput').val());
        GM.setValue('alwaysShowScrollbars', $('#alwaysShowScrollbarsCheckbox').is(':checked'));
        showFavoriteTags['draw'] = $('#showFavoriteTagsCheckbox').is(':checked');
        GM.setValue('showFavoriteTags', showFavoriteTags);
        GM.setValue('resizeButton', resizeButton);
        GM.setValue('scrollButton', scrollButton);
        location.reload();
    }

    function createToolbar() {
        if ($('#ibenhancer').length < 1 && ($(containerDOM + ' ' + imageDOM).length || $(containerDOM + ' video').length || $(thumbnailDOM).length)) {

            var titleMain = "<span id='ibe-title-main' style='font-weight:bold; transition: color 0.2s; color: #fff;'>Image Board Enhancer</span>";

            if (placeSettingsAfter) $(toolbarDOM).first().after("<div id='ibenhancer'>" + titleMain + "</div>");
            else $(toolbarDOM).first().before("<div id='ibenhancer'>" + titleMain + "</div>");

            if (showFitButton && ($(containerDOM + ' ' + imageDOM).length || $(containerDOM + ' video').length)) {
                $("#ibenhancer").append("<button id='fitContentButton' style='margin-top: 3px;'>Fit</button>");
                $("#fitContentButton").click(function () { getContentProps(); fitContent(0); });
            }

            if (showScrollButton && ($(containerDOM + ' ' + imageDOM).length || $(containerDOM + ' video').length)) {
                $("#ibenhancer").append("<button id='scrollContentButton' style='margin-top: 3px;'>Scroll</button>");
                $("#scrollContentButton").click(scrollToContent);
            }

            $("#ibenhancer").append(`
                <div id="ibenhancerSettings-blocker"></div>
                <div id="ibenhancerSettings">
                  <div id="ibenhancerSettings-options">
                    <label><input id="resizeImageToFitCheckbox" type="checkbox" ` + (resizeImageToFit ? `checked` : ``) + `>Resize images to fit screen.</label><br>
                    <label><input id="resizeVideoToFitCheckbox" type="checkbox" ` + (resizeVideoToFit ? `checked` : ``) + `>Resize videos to fit screen.</label><br>
                    <label><input id="autoplayVideosCheckbox" type="checkbox" ` + (autoplayVideos ? `checked` : ``) + `>Autoplay videos.</label><br>
                    <label><input id="autoScrollToContentCheckbox" type="checkbox" ` + (autoScrollToContent ? `checked` : ``) + `>Scroll to content.</label><br>
                    <label><input id="removeFluidCheckbox" type="checkbox" ` + (removeFluid ? `checked` : ``) + `>Remove fluid video player.</label><br>
                    <label><input id="alwaysShowScrollbarsCheckbox" type="checkbox" ` + (alwaysShowScrollbars ? `checked` : ``) + `>Always show scrollbars.</label><br>
                    <label><input id="showFavoriteTagsCheckbox" type="checkbox" ` + (showFavoriteTags['draw'] ? `checked` : ``) + `>Show favorite tags.</label><br>
                    <label>Video volume: <input id="videoVolumeInput" type="number" min="0" max="1" step="0.01" value="` + videoVolume + `" style="width:60px;">0 - 1</label><br>
                    <label>Resize keyboard shortcut: <button id="resizeButton">` + resizeButton + `</button></label><br>
                    <label>Scroll keyboard shortcut: <button id="scrollButton">` + scrollButton + `</button></label><br>
                    <button id="deleteTagDbButton">Delete Tag Database</button><br>
                  </div>
                  <button id="ibenhancerSettingsSave">Save</button><button id="ibenhancerSettingsCancel">Cancel</button>
                </div>
            ` );

            $("#ibenhancerSettingsSave").click(saveSettings);
            $("#ibenhancerSettingsCancel").click(hideSettings);
            $("#resizeButton").click(() => changeButtonClicked('resize'));
            $("#scrollButton").click(() => changeButtonClicked('scroll'));
            $("#deleteTagDbButton").click(() => GM.setValue('tagDB', {}));

            addGlobalStyle(`
                html.ibenhancerSettingVisible { overflow: hidden !important; }
                #ibenhancer { background: #000000 !important; border: solid 1px grey; padding: 5px; width: auto; text-align: center !important; margin-right: auto; ${containerAlignment} }
                #ibenhancer, #ibenhancerSettings label { font-size: 15px !important; font-family: Arial, sans-serif !important; font-style: normal !important; font-weight: normal !important; text-align: center; }
                #ibenhancerSettings-blocker { position: fixed; background-color: rgba(0, 0, 0, .5); width: 100vw; height: 100vh; top: 0; left: 0; z-index: 1; display: none; }
                #ibenhancerSettings-blocker.show { display: block; }
                #ibenhancerSettings { position: fixed; width: 400px; height: 400px; left: calc(50vw - 155px); top: calc(50vh - 165px); background-color: black; border: 2px solid black; border-radius: 3px; padding: 10px; text-align: left; z-index: 999999; display: none; color: #181a1b; padding-bottom: 0px; }
                #ibenhancerSettings-options { overflow-y: auto; overflow-x: hidden; width: 100%; height: calc(100% - 32px); }
                #ibenhancerSettings-options label { white-space: nowrap; color: white;}
                #ibenhancerSettings input { margin: 5px; width: auto; }
                #ibenhancerSettings input[type=number], #ibenhancerSettings select { border: solid 1px darkgrey; background: #fff; }
                #ibenhancer button { width: auto; border: solid 1px darkgrey !important; background: black !important; cursor: pointer; color: white; }
                #ibenhancerSettings.show { display: block; }
                #fitContentButton, #scrollContentButton { width: 73px !important; }
                #ibenhancerSettingsButton { margin: auto !important; position: relative; }
            `);

            if (showFavoriteTags['draw']) addFavoriteTags();
            if (showFavoriteTagsUSER['draw']) addFavoriteTagsUSER();
        }
    }

    function addFavoriteTags() {
        if (typeof favoriteTags[site] !== 'string') favoriteTags[site] = '';
        $("#ibenhancer").append(`
            <div id="ibenhancer-favorite-tags">
                <details>
                    <summary style="color: white;">Favorite Tags <button id="ibenhancer-favorite-tags-add-current" title="Aktuellen Such-Tag zu Favoriten hinzufügen" style="margin-top: 4px; font-size: 11px; padding: 2px 6px;">+</button></summary>
                    <div id="ibenhancer-favorite-tags-content">
                        <span id="ibenhancer-favorite-tags-edit-button">Edit</span>
                        <button id="ibenhancerSettingsButton">Settings</button>
                        <div id="ibenhancer-favorite-tags-list"></div>
                    </div>
                    <div id="ibenhancer-favorite-tags-editor">
                        <textarea id="ibenhancer-favorite-tags-textarea" style="width: 212px; height: 500px; margin: auto;color: white;"></textarea>
                        <button id="ibenhancer-favorite-tags-editor-save-button">Save</button><button id="ibenhancer-favorite-tags-editor-cancel-button">Cancel</button>
                    </div>
                </details>
            </div>
        `);

        $('#ibenhancer-favorite-tags-add-current').click(function (e) {
            e.preventDefault();
            const inputEl = document.querySelector('input[name="tags"]');
            if (!inputEl) return;
            const rawInput = inputEl.value.trim();
            if (!rawInput) return;
            const newTags = [];
            const regex = /\([^)~]+~[^)]+\)|[^\s]+/g;
            const matches = rawInput.match(regex);
            if (!matches) return;

            for (let rawTag of matches) {
                rawTag = rawTag.trim();
                const isUserTag = rawTag.startsWith('user:');
                const isPairTag = /^\(.*~.*\)$/.test(rawTag);
                const isNegated = rawTag.startsWith('-');
                const isSpecial = !isUserTag && rawTag.includes(':');
                const isComparison = /[<>!=]/.test(rawTag);

                if (isPairTag) {
                    const pairFormatted = rawTag.replace(/[()]/g, '').split('~').map(s => s.trim().replace(/\s+/g, '+')).join('+~+');
                    rawTag = `(+${pairFormatted}+)`;
                }

                if ((isUserTag || isPairTag || (!isNegated && !isSpecial && !isComparison)) && rawTag !== '') {
                    newTags.push(rawTag);
                }
            }

            const tagList = favoriteTags[site].trim().split(/\s+/).filter(t=>t);
            let changed = false;
            for (const tag of newTags) {
                const tagLower = tag.toLowerCase();
                const exists = tagList.some(existingTag => existingTag.toLowerCase() === tagLower);
                if (!exists) { tagList.push(tag); changed = true; }
            }
            if (changed) {
                favoriteTags[site] = tagList.join(' ');
                GM.setValue('favoriteTags', favoriteTags);
                renderFavoriteTags();
                updateTitleColors();
            }
        });

        if (showFavoriteTags['open']) $('#ibenhancer-favorite-tags > details').attr('open', true);
        $('#ibenhancer-favorite-tags > details > summary').click(function () {
            setTimeout(function () {
                showFavoriteTags['open'] = $('#ibenhancer-favorite-tags > details')[0].open;
                GM.setValue('showFavoriteTags', showFavoriteTags);
            });
        });

        $('#ibenhancer-favorite-tags-edit-button').click(function () {
            const textarea = $('#ibenhancer-favorite-tags-textarea');
            textarea.val(favoriteTags[site]);
            $('#ibenhancer-favorite-tags').addClass('edit');
            setTimeout(() => { textarea[0].scrollTop = textarea[0].scrollHeight; }, 0);
        });

        $('#ibenhancer-favorite-tags-editor-cancel-button').click(function () {
            $('#ibenhancer-favorite-tags').removeClass('edit');
        });

        $('#ibenhancer-favorite-tags-editor-save-button').click(function () {
            favoriteTags[site] = $('#ibenhancer-favorite-tags-textarea').val();
            GM.setValue('favoriteTags', favoriteTags);
            renderFavoriteTags();
            updateTitleColors();
            setTimeout(function() { $('#ibenhancer-favorite-tags').removeClass('edit'); });
        });

        function renderFavoriteTags() {
            var tags = favoriteTags[site].split(' ').reverse();
            $('#ibenhancer-favorite-tags-list').html(getTagsHtml(tags));
        }

        renderFavoriteTags();

        addGlobalStyle(`
            #ibenhancer-favorite-tags > details > summary { margin-left: -8px; list-style: none; cursor: pointer; }
            #ibenhancer-favorite-tags details summary::-webkit-details-marker { display: none; }
            #ibenhancer-favorite-tags details summary:after { content: '►'; float: right; transform: rotate(90deg); }
            #ibenhancer-favorite-tags details[open] summary:after { transform: rotate(270deg); }
            #ibenhancer-favorite-tags details { text-align: left; padding: 2px 8px; color: white; }
            #ibenhancer-favorite-tags details[open] { height:525px; }
            #ibenhancer-favorite-tags-edit-button { color: white; cursor: pointer; user-select: none; margin-right: 100px; }
            #ibenhancer-favorite-tags-edit-button:hover { text-decoration: underline; }
            #ibenhancer-favorite-tags #ibenhancer-favorite-tags-editor { display: none; }
            #ibenhancer-favorite-tags.edit #ibenhancer-favorite-tags-content { display: none; }
            #ibenhancer-favorite-tags.edit #ibenhancer-favorite-tags-editor { display: block; }
            #ibenhancer-favorite-tags-list { display: flex; flex-direction: column; max-height: 500px; overflow-y: auto; overflow-x: hidden; }
            #ibenhancer-favorite-tags-list a { color: #ff6c6c; }
        `);
    }

    function addFavoriteTagsUSER() {
        if (typeof favoriteTagsUSER[site] !== 'string') favoriteTagsUSER[site] = '';

        var titleUser = "<span id='ibe-title-user' style='font-weight:bold; transition: color 0.2s; color: #fff;'>Image Board Enhancer User</span>";

        $("#ibenhancer").append(`
            <br>` + titleUser + `
            <div id="ibenhancerUSER-favorite-tags">
                <details>
                    <summary style="color: white;">Favorite Tags <button id="ibenhancerUSER-favorite-tags-add-current" title="Aktuellen Such-Tag zu Favoriten hinzufügen" style="margin-top: 4px; font-size: 11px; padding: 2px 6px;">+</button></summary>
                    <div id="ibenhancerUSER-favorite-tags-content">
                        <span id="ibenhancerUSER-favorite-tags-edit-button">Edit</span>
                        <div id="ibenhancerUSER-favorite-tags-list"></div>
                    </div>
                    <div id="ibenhancerUSER-favorite-tags-editor">
                        <textarea id="ibenhancerUSER-favorite-tags-textarea" style="width: 212px; height: 500px; margin: auto;color: white;"></textarea>
                        <button id="ibenhancerUSER-favorite-tags-editor-save-button">Save</button><button id="ibenhancerUSER-favorite-tags-editor-cancel-button">Cancel</button>
                    </div>
                </details>
            </div>
        `);

        $('#ibenhancerUSER-favorite-tags-add-current').click(function (e) {
            e.preventDefault();
            const inputEl = document.querySelector('input[name="tags"]');
            if (!inputEl) return;
            const rawInput = inputEl.value.trim();
            if (!rawInput) return;
            const newTags = [];
            const regex = /\([^)~]+~[^)]+\)|[^\s]+/g;
            const matches = rawInput.match(regex);
            if (!matches) return;

            for (let rawTag of matches) {
                rawTag = rawTag.trim();
                const isUserTag = rawTag.startsWith('user:');
                const isPairTag = /^\(.*~.*\)$/.test(rawTag);
                const isNegated = rawTag.startsWith('-');
                const isSpecial = !isUserTag && rawTag.includes(':');
                const isComparison = /[<>!=]/.test(rawTag);

                if (isPairTag) {
                    const pairFormatted = rawTag.replace(/[()]/g, '').split('~').map(s => s.trim().replace(/\s+/g, '+')).join('+~+');
                    rawTag = `(+${pairFormatted}+)`;
                }

                if ((isUserTag || isPairTag || (!isNegated && !isSpecial && !isComparison)) && rawTag !== '') {
                    newTags.push(rawTag);
                }
            }

            const tagList = favoriteTagsUSER[site].trim().split(/\s+/).filter(t=>t);
            let changed = false;
            for (const tag of newTags) {
                const tagLower = tag.toLowerCase();
                const exists = tagList.some(existingTag => {
                    if (tagLower.startsWith('user:') && existingTag.toLowerCase().startsWith('user:')) {
                        return existingTag.toLowerCase() === tagLower;
                    }
                    return existingTag === tag;
                });
                if (!exists) { tagList.push(tag); changed = true; }
            }

            if (changed) {
                favoriteTagsUSER[site] = tagList.join(' ');
                GM.setValue('favoriteTagsUSER', favoriteTagsUSER);
                renderFavoriteTagsUSER();
                updateTitleColors();
            }
        });

        if (showFavoriteTagsUSER['open']) $('#ibenhancerUSER-favorite-tags > details').attr('open', true);
        $('#ibenhancerUSER-favorite-tags > details > summary').click(function () {
            setTimeout(function () {
                showFavoriteTagsUSER['open'] = $('#ibenhancerUSER-favorite-tags > details')[0].open;
                GM.setValue('showFavoriteTagsUSER', showFavoriteTagsUSER);
            });
        });

        $('#ibenhancerUSER-favorite-tags-edit-button').click(function () {
            const textarea = $('#ibenhancerUSER-favorite-tags-textarea');
            textarea.val(favoriteTagsUSER[site]);
            $('#ibenhancerUSER-favorite-tags').addClass('edit');
            setTimeout(() => { textarea[0].scrollTop = textarea[0].scrollHeight; }, 0);
        });

        $('#ibenhancerUSER-favorite-tags-editor-cancel-button').click(function () {
            $('#ibenhancerUSER-favorite-tags').removeClass('edit');
        });

        $('#ibenhancerUSER-favorite-tags-editor-save-button').click(function () {
            favoriteTagsUSER[site] = $('#ibenhancerUSER-favorite-tags-textarea').val();
            GM.setValue('favoriteTagsUSER', favoriteTagsUSER);
            renderFavoriteTagsUSER();
            updateTitleColors();
            setTimeout(function() { $('#ibenhancerUSER-favorite-tags').removeClass('edit'); });
        });

        function renderFavoriteTagsUSER() {
            var tags = favoriteTagsUSER[site].split(' ').reverse();
            $('#ibenhancerUSER-favorite-tags-list').html(getTagsHtmlUSER(tags));
        }

        renderFavoriteTagsUSER();

        addGlobalStyle(`
            #ibenhancerUSER-favorite-tags > details > summary { margin-left: -8px; list-style: none; cursor: pointer; }
            #ibenhancerUSER-favorite-tags details summary::-webkit-details-marker { display: none; }
            #ibenhancerUSER-favorite-tags details summary:after { content: '►'; float: right; transform: rotate(90deg); }
            #ibenhancerUSER-favorite-tags details[open] summary:after { transform: rotate(270deg); }
            #ibenhancerUSER-favorite-tags details { text-align: left; padding: 2px 8px; color: white; }
            #ibenhancerUSER-favorite-tags-edit-button { color: white; cursor: pointer; user-select: none; margin-right: 100px; }
            #ibenhancerUSER-favorite-tags-edit-button:hover { text-decoration: underline; }
            #ibenhancerUSER-favorite-tags #ibenhancerUSER-favorite-tags-editor { display: none; }
            #ibenhancerUSER-favorite-tags.edit #ibenhancerUSER-favorite-tags-content { display: none; }
            #ibenhancerUSER-favorite-tags.edit #ibenhancerUSER-favorite-tags-editor { display: block; }
            #ibenhancerUSER-favorite-tags-list { display: flex; flex-direction: column; max-height: 500px; overflow-y: auto; overflow-x: hidden; }
            #ibenhancerUSER-favorite-tags-list a { color: #8b1eb0; }
        `);
    }

    function keyboardShortcuts() {
        document.addEventListener('keyup', (e) => {
            if (changeKeyboardShortcut && e.code == 'Escape') {
                $('#resizeButton').html(resizeButton);
                $('#scrollButton').html(scrollButton);
                changeKeyboardShortcut = false;
            }
            if (!changeKeyboardShortcut) {
                if (e.code === resizeButton) { getContentProps(0); fitContent(0); }
                else if (e.code === scrollButton) scrollToContent(0);
            }
            else if (changeKeyboardShortcut == 'resizeButton') {
                resizeButton = e.code;
                $('#resizeButton').html(e.code);
                changeKeyboardShortcut = false;
            }
            else if (changeKeyboardShortcut == 'scrollButton') {
                scrollButton = e.code;
                $('#scrollButton').html(e.code);
                changeKeyboardShortcut = false;
            }
        });
    }

    function getTagsHtml(tags) {
        var tagHTML = '';
        var linksHTML = [];
        for (var i = 0; i < tags.length; i++) {
            if (tags[i] == '//') break;
            if (tags[i] != '') {
                let displayTag = tags[i];
                if (/^\(\+.+\+~\+.+\+\)$/.test(displayTag)) {
                    const inner = displayTag.slice(2, -2).split('+').join(' ').trim();
                    displayTag = `( ${inner} )`;
                }
                var color = '';
                var tagtype = 5;
                if (displayTag.startsWith("rating:") || displayTag.startsWith("score:") || displayTag.startsWith("user:") || displayTag.startsWith("id:") || displayTag.startsWith("date:") || displayTag.startsWith("status:") || displayTag.startsWith("size:")) tagtype = 10;
                if (typeof tagDB[site] !== 'undefined' && typeof tagDB[site][displayTag.replaceAll('_', ' ')] !== 'undefined') {
                    color = 'style="color:' + tagDB[site][displayTag.replaceAll('_', ' ')].color + ' !important;"';
                    tagtype = tagDB[site][displayTag.replaceAll('_', ' ')].type;
                }
                var plusLink = `<a href="https://rule34.xxx/" onclick="document.querySelector('input[name=tags]').value += ' ${displayTag}'; return false;" ${color}>+</a>`;
                var minusLink = `<a href="https://rule34.xxx/" onclick="document.querySelector('input[name=tags]').value += ' -${displayTag}'; return false;" ${color}>-</a>`;
                var tagLink  = `<a href="${tagSearchLink}${displayTag}" ${color}>${displayTag}</a>`;
                linksHTML.push({ html: `<span>${plusLink}&nbsp;${minusLink}&nbsp;${tagLink}</span>`, type: tagtype });
            }
        }
        linksHTML.sort((a, b) => a.type - b.type);
        for (let i = 0; i < linksHTML.length; i++) { tagHTML += linksHTML[i].html; }
        return tagHTML;
    }

    function getTagsHtmlUSER(tags) {
        var tagHTML = '';
        var linksHTML = [];
        for (var i = 0; i < tags.length; i++) {
            if (tags[i] == '//') break;
            if (tags[i] != '') {
                let displayTag = tags[i];
                if (/^\(\+.+\+~\+.+\+\)$/.test(displayTag)) {
                    const inner = displayTag.slice(2, -2).split('+').join(' ').trim();
                    displayTag = `( ${inner} )`;
                }
                var color = '';
                if (typeof tagDB[site] !== 'undefined' && typeof tagDB[site][displayTag.replaceAll('_', ' ')] !== 'undefined') {
                    color = 'style="color:' + tagDB[site][displayTag.replaceAll('_', ' ')].color + ' !important;"';
                }
                var plusLink = `<a href="https://rule34.xxx/" onclick="document.querySelector('input[name=tags]').value += ' ${displayTag}'; return false;" ${color}>+</a>`;
                var minusLink = `<a href="https://rule34.xxx/" onclick="document.querySelector('input[name=tags]').value += ' -${displayTag}'; return false;" ${color}>-</a>`;
                var tagLink  = `<a href="${tagSearchLink}${displayTag}" ${color}>${displayTag}</a>`;
                linksHTML.push({ html: `<span>${plusLink}&nbsp;${minusLink}&nbsp;${tagLink}</span>` });
            }
        }
        for (let i = 0; i < linksHTML.length; i++) { tagHTML += linksHTML[i].html; }
        return tagHTML;
    }

    // ==========================================
    // NEW FEATURE: Header Validation Colors
    // ==========================================
    function updateTitleColors() {
        const inputEl = document.querySelector('input[name="tags"]');
        if (!inputEl) return;

        const rawInput = inputEl.value.trim();
        const cleanInput = rawInput.replace(/[()~]/g, ' ');
        const tokens = cleanInput.split(/\s+/).filter(t => t);

        const ignoredExact = ['sort:score', '-animated', '-video', 'height:>1000', '-animation'];

        let validTokensToCheck = [];

        for (let token of tokens) {
            let tokenLower = token.toLowerCase();
            if (ignoredExact.includes(tokenLower)) continue;

            let baseTag = tokenLower.startsWith('user:') ? tokenLower.substring(5) : tokenLower;

            if (baseTag) {
                validTokensToCheck.push(baseTag);
            }
        }

        const titleMain = document.getElementById('ibe-title-main');
        const titleUser = document.getElementById('ibe-title-user');

        if (!titleMain || !titleUser) return;

        if (validTokensToCheck.length === 0) {
            titleMain.style.color = '#fff';
            titleUser.style.color = '#fff';
            return;
        }

        const checkTokensInDB = (searchTokens, dbString) => {
            const cleanDbString = (dbString || "").toLowerCase().replace(/[()~+]/g, ' ');
            const dbTokens = cleanDbString.split(/\s+/).filter(t => t);
            const finalDbBases = dbTokens.map(t => t.startsWith('user:') ? t.substring(5) : t);
            return searchTokens.some(searchBase => finalDbBases.includes(searchBase));
        };

        const matchMain = checkTokensInDB(validTokensToCheck, favoriteTags[site]);
        const matchUser = checkTokensInDB(validTokensToCheck, favoriteTagsUSER[site]);

        titleMain.style.color = matchMain ? '#00FF00' : '#FF0000';
        titleUser.style.color = matchUser ? '#00FF00' : '#FF0000';
    }

    function addGlobalStyle(css) {
        var head, style;
        head = document.getElementsByTagName('head')[0];
        if (!head) { return; }
        style = document.createElement('style');
        style.setAttribute('type', 'text/css');
        style.innerHTML = css;
        head.appendChild(style);
    }

    configureSites();
    addWindowEvents();
    createToolbar();
    keyboardShortcuts();
    enhanceContent();

    $(document).ready(() => {
        updateTitleColors();
        $(document).on('input', 'input[name="tags"]', updateTitleColors);

        // Fix: Globaler Event Listener für den dynamischen Settings Button
        $(document).on('click', '#ibenhancerSettingsButton', showSettings);
    });

})();