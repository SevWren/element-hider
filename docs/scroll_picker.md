# Feature Implementation: Mouse Wheel DOM Traversal for Element Picker

This document outlines the implementation plan to add a new feature to the "Element Hider: TM's Masterpiece" Chrome extension. The feature allows users to scroll the mouse wheel while the element picker is active to traverse up the DOM tree, highlighting parent elements instead of the currently hovered element.

## Implementation Plan

1. **Modify the `Picker` Module in `content.js`**:
    * Add a `wheel` event listener when the picker is activated to detect mouse scroll events.
    * On each scroll event (up or down), move the highlighted element to its `parentElement`.
    * Prevent default scrolling behavior during picker mode to avoid page scrolling.
    * Update the highlight by clearing the current element’s outline and applying it to the parent, ensuring compatibility with existing `throttledMouseOver` and `handleMouseOut` logic.
    * Clean up the `wheel` event listener when deactivating the picker to prevent memory leaks.

2. **Preserve Existing Behavior**:
    * Ensure `mouseover`, `mouseout`, `mousedown`, and `keydown` handlers remain unchanged to maintain current picker functionality (e.g., clicking to hide, keypress to cancel).
    * The new `wheel` handler only updates the `highlightElement`, ensuring compatibility with selector generation (`generateSelector`) and click-to-hide logic.

3. **Edge Cases**:
    * If the highlighted element has no parent (e.g., at `<html>` or `<body>`), stop traversing to avoid errors.
    * Throttle the wheel event to prevent performance issues from rapid scroll events, similar to the 50ms throttle used for `mouseover`.
    * Ensure the picker remains active and the cursor stays as a crosshair during scrolling.
    * Handle cases where `highlightElement` is `null` or picker mode is inactive.

4. **No Changes to Other Files**:
    * The feature is confined to the `Picker` module in `content.js`. No modifications are needed for `popup.js`, `background.js`, `manifest.json`, `preset.json`, or `styles.css`.

## Modified `content.js`

Below is the complete `content.js` file with the new wheel-scroll feature integrated into the `Picker` module. The changes include adding a `handleWheel` function and updating the `activate` and `deactivate` methods to manage the new event listener.

```javascript
/**
 * @fileoverview Content script for the Element Hider Chrome extension.
 * This script is injected into web pages as defined in `manifest.json`. It handles all direct DOM
 * manipulation, including hiding elements, managing the element picker, and observing page changes.
 * It communicates with the `background.js` service worker to receive commands triggered by hotkeys
 * and with the `popup.js` script to receive updated selector lists.
 */
(function() {
    'use strict';

    /**
     * Global flag to enable or disable verbose logging for development.
     * Set to `false` in production builds to keep the console clean for end-users.
     * @type {boolean}
     */
    const DEBUG = true;

    /**
     * A namespaced logger utility to standardize console output.
     * It respects the `DEBUG` flag for non-critical messages.
     * @type {{log: function, warn: function, error: function}}
     */
    const logger = {
        log: (...args) => DEBUG && console.log('Element Hider:', ...args),
        warn: (...args) => DEBUG && console.warn('Element Hider:', ...args),
        error: (...args) => console.error('Element Hider:', ...args),
    };

    /**
     * Extracts the current hostname from `window.location.hostname`.
     * This is used as the key for storing and retrieving selectors, ensuring rules are
     * specific to the exact hostname (e.g., 'www.example.com' is distinct from 'app.example.com').
     * @returns {string} The hostname of the current page.
     */
    function getCurrentDomain() {
        if (window.location.protocol === 'file:') {
            return 'file://';
        }
        return window.location.hostname;
    }

    /**
     * A session-specific history stack for the element picker tool.
     * This acts as a Last-In, First-Out (LIFO) stack, tracking only the selectors
     * added via the hotkey-picker in the current page session. It is used by the
     * "Revert Last Action" feature and is cleared on manual updates from the popup.
     * @type {Array<string>}
     */
    let pickerActionHistory = [];

    /**
     * Injects or updates a `<style>` tag in the document's `<head>` to hide elements.
     * This function uses a "nuke and pave" approach: it completely removes any pre-existing
     * style tag managed by this extension before creating a new one. This ensures maximum
     * compatibility with modern frameworks (React, Vue, etc.).
     * @param {string[]} selectors - An array of CSS selectors for elements to be hidden.
     * @returns {void}
     */
    function updateHiddenElements(selectors) {
        let style = document.getElementById('element-hider-style');
        if (style) {
            style.remove();
        }
        if (!selectors || selectors.length === 0) {
            return;
        }
        style = document.createElement('style');
        style.id = 'element-hider-style';
        const cssRules = selectors.map(selector => `${selector} { display: none !important; }`).join('\n');
        style.textContent = cssRules;
        document.head.appendChild(style);
    }

    /**
     * A module encapsulating all logic for the Element Picker feature.
     * Follows the IIFE module pattern to create a private scope for its state
     * and internal functions, exposing only a clean public API.
     * @returns {{activate: function, deactivate: function, isActive: function}}
     */
    const Picker = (function() {
        let isPickerModeActive = false;
        let highlightElement = null;

        /**
         * Throttles a function to limit its execution rate.
         * Crucial for performance on high-frequency events like `mouseover` and `wheel`.
         * @param {function} func - The function to throttle.
         * @param {number} limit - The minimum time in milliseconds between executions.
         * @returns {function} The new throttled function.
         */
        function throttle(func, limit) {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            }
        }

        /**
         * Event handler to cancel picker mode upon any key press.
         * @param {KeyboardEvent} event - The keyboard event object.
         */
        function handleKeydownCancel(event) {
            event.preventDefault();
            event.stopPropagation();
            logger.log(`Key press (${event.key}) detected. Cancelling selection.`);
            deactivate();
        }

        /**
         * Unified mouse event handler for confirming or canceling a selection.
         * @param {MouseEvent} event - The mouse event object.
         */
        async function handleMouseAction(event) {
            event.preventDefault();
            event.stopPropagation();
            if (event.button !== 0) {
                logger.log(`Mouse button ${event.button} press detected. Cancelling selection.`);
                deactivate();
                return;
            }

            logger.log('Left mouse press CONFIRMED selection.');
            const clickedElement = event.target;
            const selector = generateSelector(clickedElement);

            try {
                const result = await chrome.storage.local.get({ selectors: {} });
                const allSelectors = result.selectors || {};
                const currentDomain = getCurrentDomain();
                const domainSelectors = allSelectors[currentDomain] || [];

                if (!domainSelectors.includes(selector)) {
                    const newDomainSelectors = [...domainSelectors, selector];
                    const newAllSelectors = {
                        ...allSelectors,
                        [currentDomain]: newDomainSelectors
                    };
                    await chrome.storage.local.set({ selectors: newAllSelectors });
                    updateHiddenElements(newDomainSelectors);
                    pickerActionHistory.push(selector);
                    logger.log('Selector saved and applied for domain:', currentDomain, selector);
                } else {
                    logger.log('Selector already exists for domain:', currentDomain, selector);
                }
            } catch (error) {
                logger.error("An error occurred while handling the click.", error);
            } finally {
                deactivate();
            }
        }

        /**
         * Handles mouse wheel scrolling to traverse up the DOM tree.
         * Moves the highlight to the parent element of the current highlightElement.
         * @param {WheelEvent} event - The wheel event object.
         */
        const handleWheel = throttle((event) => {
            event.preventDefault(); // Prevent page scrolling
            if (!highlightElement || !isPickerModeActive) return;

            const parent = highlightElement.parentElement;
            if (parent && parent !== document.documentElement) { // Stop at <html>
                highlightElement.style.outline = ''; // Clear current highlight
                highlightElement = parent; // Move to parent
                highlightElement.style.outline = '2px solid #e60000'; // Apply new highlight
                logger.log('Wheel scrolled, highlighting parent:', generateSelector(highlightElement));
            } else {
                logger.log('No parent element to highlight or at root.');
            }
        }, 100); // Throttle to 100ms for smooth but controlled updates

        /**
         * Throttled mouseover handler for initial element highlighting.
         */
        const throttledMouseOver = throttle((event) => {
            if (highlightElement) {
                highlightElement.style.outline = '';
            }
            highlightElement = event.target;
            highlightElement.style.outline = '2px solid #e60000';
        }, 50);

        /**
         * Clears highlight when the mouse leaves an element.
         */
        function handleMouseOut(event) {
            if (event.target && event.target === highlightElement) {
                highlightElement.style.outline = '';
                highlightElement = null;
            }
        }

        /**
         * Generates a robust and specific CSS selector for a given DOM element.
         * @param {Element} el - The DOM element to generate a selector for.
         * @returns {string} The generated CSS selector.
         */
        function generateSelector(el) {
            const escapeCSS = (str) => {
                if (typeof str !== 'string') return '';
                return str.replace(/([#;&,.+*~':"!^$\[\]()<=>|/])/g, '\\$1');
            };

            const stableAttrs = ['data-testid', 'data-cy', 'data-test', 'name', 'aria-label'];
            for (const attr of stableAttrs) {
                const attrValue = el.getAttribute(attr);
                if (attrValue) return `${el.tagName.toLowerCase()}[${attr}="${attrValue}"]`;
            }
            if (el.id) return `#${escapeCSS(el.id)}`;

            let path = [];
            let current = el;
            while (current.parentElement) {
                let segment = current.tagName.toLowerCase();
                const stableClasses = Array.from(current.classList)
                    .filter(c => !/hover|active|focus/.test(c))
                    .map(c => `.${escapeCSS(c)}`)
                    .join('');
                if (stableClasses) segment += stableClasses;
                const siblings = Array.from(current.parentElement.children);
                const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);
                if (sameTagSiblings.length > 1) {
                    const index = sameTagSiblings.indexOf(current) + 1;
                    segment += `:nth-of-type(${index})`;
                }
                path.unshift(segment);
                current = current.parentElement;
            }
            return path.join(' > ');
        }

        /**
         * Activates the element picker mode.
         */
        function activate() {
            if (isPickerModeActive) return;
            isPickerModeActive = true;
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mouseover', throttledMouseOver);
            document.addEventListener('mouseout', handleMouseOut);
            document.addEventListener('keydown', handleKeydownCancel, { capture: true });
            document.addEventListener('mousedown', handleMouseAction, { capture: true });
            document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
            logger.log('Picker mode ACTIVATED.');
        }

        /**
         * Deactivates the element picker mode.
         */
        function deactivate() {
            if (!isPickerModeActive) return;
            isPickerModeActive = false;
            document.body.style.cursor = 'default';
            if (highlightElement) {
                highlightElement.style.outline = '';
                highlightElement = null;
            }
            document.removeEventListener('mouseover', throttledMouseOver);
            document.removeEventListener('mouseout', handleMouseOut);
            document.removeEventListener('keydown', handleKeydownCancel, { capture: true });
            document.removeEventListener('mousedown', handleMouseAction, { capture: true });
            document.removeEventListener('wheel', handleWheel, { capture: true });
            logger.log('Picker mode DEACTIVATED.');
        }

        return { activate, deactivate, isActive: () => isPickerModeActive };
    })();

    /**
     * Initializes the extension's state on page load.
     */
    async function initialize() {
        try {
            const result = await chrome.storage.local.get(['selectors', 'isPersistenceEnabled']);
            const shouldPersist = result.isPersistenceEnabled !== false;
            const currentDomain = getCurrentDomain();
            const domainSelectors = result.selectors?.[currentDomain] || [];

            if (shouldPersist && domainSelectors.length > 0) {
                updateHiddenElements(domainSelectors);
            }
        } catch (error) {
            logger.error("Failed to initialize.", error);
        }
    }

    /**
     * Reverts the last element hidden by the picker tool.
     */
    async function revertLastAction() {
        if (pickerActionHistory.length === 0) {
            logger.warn("No actions in session history to revert.");
            return;
        }
        const selectorToRevert = pickerActionHistory.pop();
        logger.log("Reverting selector:", selectorToRevert);
        try {
            const result = await chrome.storage.local.get({ selectors: {} });
            const allSelectors = result.selectors || {};
            const currentDomain = getCurrentDomain();
            let domainSelectors = allSelectors[currentDomain] || [];
            const newDomainSelectors = domainSelectors.filter(s => s !== selectorToRevert);

            if (newDomainSelectors.length === 0) {
                delete allSelectors[currentDomain];
            } else {
                allSelectors[currentDomain] = newDomainSelectors;
            }

            await chrome.storage.local.set({ selectors: allSelectors });
            updateHiddenElements(newDomainSelectors);
        } catch (error) {
            logger.error("Error during revert action:", error);
            pickerActionHistory.push(selectorToRevert);
        }
    }

    /**
     * Main message listener for commands from `background.js` and `popup.js`.
     */
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateSelectors') {
            pickerActionHistory = [];
            logger.log("Session history cleared due to manual update from popup.");
            const currentDomain = getCurrentDomain();
            const domainSelectors = request.selectors?.[currentDomain] || [];
            updateHiddenElements(domainSelectors);
            sendResponse({ status: "Selectors updated and history cleared" });
        } else if (request.action === 'togglePickerMode') {
            Picker.isActive() ? Picker.deactivate() : Picker.activate();
            sendResponse({ status: "Picker mode toggled" });
        } else if (request.action === 'revertLastAction') {
            revertLastAction();
            sendResponse({ status: "Revert action triggered" });
        }
        return true;
    });

    /**
     * Starts a MutationObserver to handle dynamically loaded content on SPAs.
     */
    function startMutationObserver() {
        let debounceTimeout;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(async () => {
                logger.log('DOM changed (debounced), re-applying rules.');
                try {
                    const result = await chrome.storage.local.get(['selectors', 'isPersistenceEnabled']);
                    const currentDomain = getCurrentDomain();
                    const domainSelectors = result.selectors?.[currentDomain] || [];

                    if (result.isPersistenceEnabled !== false && domainSelectors.length > 0) {
                        updateHiddenElements(domainSelectors);
                    }
                } catch (error) {
                    logger.error("Error re-applying rules in MutationObserver.", error);
                }
            }, 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        logger.log("MutationObserver started.");
    }

    // --- Initial Kick-off ---
    initialize();
    startMutationObserver();
})();
```
