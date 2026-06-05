// ==UserScript==
// @name        Rule34 Quick Buttons++
// @namespace   miep
// @match       https://rule34.xxx/*
// @match       https://rule34.xxx/index.php?page=post&s=list&tags=*
// @match       https://rule34.xxx/index.php?page=post&s=view&id=*&tags=*
// @grant       none
// @version     7
// @author      jAstn (modified by Gemini)
// @description Adds quick tag buttons instantly using MutationObserver for dynamic pages.
// @require     https://code.jquery.com/jquery-3.5.1.min.js
// @icon        https://i.imgur.com/A4mCAUN.png
// @license     MIT
// @run-at      document-body
// ==/UserScript==

function initializeButtons() {
    const searchField = document.getElementsByName("tags")[0];
    const searchButton = document.getElementsByName("tag-search")[0];
    let boxShadowHidden = false;

    // A list of special tags that should NOT be grouped within parentheses
    const EXCLUDE_TAGS = [
        "-animated",
        "-video",
        "height:>1000",
        "sort:score",
        "-animation",
    ];

    function formatTagsWithTilde() {
        let tags = searchField.value
            .replace(/[()]/g, "")           // Remove parentheses
            .replace(/~/g, "")              // Remove existing tildes
            .trim()
            .split(/\s+/)
            .filter(Boolean);              // Filter out empty strings

        let groupedTags = [];
        let specialTags = [];

        for (let tag of tags) {
            if (EXCLUDE_TAGS.includes(tag)) {
                specialTags.push(tag);
            } else {
                groupedTags.push(tag);
            }
        }

        let groupedStr = groupedTags.length > 0 ? `( ${groupedTags.join(" ~ ")} )` : "";
        let specialStr = specialTags.join(" ");

        searchField.value = [groupedStr, specialStr].filter(Boolean).join(" ").trim();
        searchButton.click();
    }

    // Observes DOM changes
    function observeDOM(callback) {
        const observer = new MutationObserver(callback);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Creates a toggle button
    function createButton(text, innerHTML, customHandler) {
        const button = document.createElement("button");
        button.innerHTML = innerHTML;
        button.style.cursor = "pointer";
        button.style.margin = "2px 5px 2px 0";
        button.onclick = function () {
            if (typeof customHandler === "function") {
                customHandler();
            } else {
                searchField.value += " " + text;
            }
        };
        return button;
    }

    // Toggles the visibility of favorited images
    function processBoxShadowImages() {
        document.querySelectorAll('img').forEach(img => {
            const boxShadow = getComputedStyle(img).boxShadow;
            const opacity = getComputedStyle(img).opacity;
            if (boxShadow && (boxShadow.includes('rgb(255, 0, 0)') || opacity.includes('0.3'))) {
                const container = img.closest('span.thumb, article.thumbnail-preview, div.post') || img.parentElement || img;
                container.style.opacity = boxShadowHidden ? '0.1' : '1';
                container.style.pointerEvents = boxShadowHidden ? 'none' : 'auto';
                container.dataset.boxshadowToggle = 'true';
            }
        });
    }

    // Applies the visibility toggle to newly loaded images
    const runBoxShadowObserver = () => {
        if (boxShadowHidden) processBoxShadowImages();
    };
/*
    // Handler for the favorite toggle button
    function toggleBoxShadowImages() {
        boxShadowHidden = !boxShadowHidden;
        processBoxShadowImages();
        toggleBoxShadowButton.innerHTML = boxShadowHidden ? "Show Favorite" : "Hide Favorite";
    }

    observeDOM(runBoxShadowObserver);
*/
    // --- Create Buttons ---
    const TildeTagsButton = createButton("", "~ Tags", formatTagsWithTilde);
    const sortScoreanimatedButton = createButton("sort:score -animated -video height:>1000 -animation", "Combined");
    const sortScoreButton = createButton("sort:score", "Sort by Score");
    const animatedButton = createButton("-animated -video -animation", "No Animation");
    const HeightButton = createButton("height:>1000", "Height");
 /*   const toggleBoxShadowButton = createButton("", "Hide Favorite", toggleBoxShadowImages); */

    // --- Add Buttons to the Page ---
    const tagSearchContainer = document.getElementsByClassName("tag-search")[0];
    tagSearchContainer.appendChild(TildeTagsButton);
    tagSearchContainer.appendChild(sortScoreanimatedButton);
    tagSearchContainer.appendChild(sortScoreButton);
    tagSearchContainer.appendChild(animatedButton);
    tagSearchContainer.appendChild(HeightButton);
 /*   tagSearchContainer.appendChild(toggleBoxShadowButton); */
}

// --- Loader using MutationObserver ---
// This will actively wait for the target element to be added to the page.
const observer = new MutationObserver((mutations, obs) => {
    const targetContainer = document.getElementsByClassName("tag-search")[0];
    if (targetContainer) {
        // Element is found, run the main function to add buttons
        initializeButtons();
        // Stop observing to save resources, as our job is done
        obs.disconnect();
    }
});

// Start observing the entire document for any additions to the DOM tree
observer.observe(document.documentElement, {
    childList: true,
    subtree: true
});