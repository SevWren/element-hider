/**
 * @fileoverview Content script for the Element Hider Chrome extension.
 * This script is injected into web pages as defined in `manifest.json`. It handles all direct DOM
 * manipulation, including hiding elements, managing the element picker, and observing page changes.
 * It communicates with the `background.js` service worker to receive commands triggered by hotkeys
 * and with the `popup.js` script to receive updated selector lists.
 */

/**
 * The entire script is wrapped in an Immediately Invoked Function Expression (IIFE) `(function() { ... })();`.
 * This creates a private scope, preventing its variables and functions (`DEBUG`, `logger`, `Picker`, etc.)
 * from polluting the global `window` object of the web page it's injected into. This is a critical
 * best practice for content scripts to avoid conflicts with the page's own JavaScript.
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
        error: (...args) => console.error('Element Hider:', ...args), // Errors are always logged.
    };

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
     * compatibility with modern frameworks (React, Vue, etc.) that might ignore simple
     * `textContent` updates to a "zombie" style tag.
     *
     * @param {string[]} selectors - An array of CSS selectors for elements to be hidden.
     * @returns {void}
     */
    function updateHiddenElements(selectors) {
        let style = document.getElementById('element-hider-style');
        if (style) {
            style.remove();
        }
        if (!selectors || selectors.length === 0) {
            return; // Exit if there are no selectors to apply.
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
     * (`isPickerModeActive`, `highlightElement`) and internal functions, exposing
     * only a clean public API (`activate`, `deactivate`, `isActive`).
     *
     * @returns {{activate: function, deactivate: function, isActive: function}}
     */
    const Picker = (function() {
        let isPickerModeActive = false;
        let highlightElement = null;

        /**
         * Throttles a function to limit its execution rate.
         * Crucial for performance on high-frequency events like `mouseover`.
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
         * Unified mouse event handler using `async/await` for robust, sequential operation.
         * It handles both confirming a selection (left-click) and canceling (any other mouse button).
         * Using `mousedown` is more reliable than `click` on complex websites that may stop event propagation.
         * @param {MouseEvent} event - The mouse event object.
         */
        async function handleMouseAction(event) {
            event.preventDefault();
            event.stopPropagation();
            // Cancel if not a primary (left) click.
            if (event.button !== 0) {
                logger.log(`Mouse button ${event.button} press detected. Cancelling selection.`);
                deactivate();
                return;
            }

            logger.log('Left mouse press CONFIRMED selection.');
            const clickedElement = event.target;
            const selector = generateSelector(clickedElement);
            
            try {
                // AWAIT ensures each step completes before the next one starts.
                const result = await chrome.storage.local.get({ selectors: [] });
                const existingSelectors = result.selectors || [];

                if (!existingSelectors.includes(selector)) {
                    const newSelectors = [...existingSelectors, selector];
                    await chrome.storage.local.set({ selectors: newSelectors });
                    updateHiddenElements(newSelectors);
                    pickerActionHistory.push(selector); // Add to session history for revert feature.
                    logger.log('Selector saved and applied:', selector);
                } else {
                    logger.log('Selector already exists.');
                }
            } catch (error) {
                logger.error("An error occurred while handling the click.", error);
            } finally {
                // Deactivate the picker mode AFTER all async work is done.
                deactivate();
            }
        }
        
        /** A throttled version of the mouseover handler for performance. */
        const throttledMouseOver = throttle((event) => {
            if (highlightElement) {
                highlightElement.style.outline = '';
            }
            highlightElement = event.target;
            highlightElement.style.outline = '2px solid #e60000';
        }, 50);

        /** Event handler to clear the highlight when the mouse leaves an element. */
        function handleMouseOut(event) {
            if (event.target) {
                event.target.style.outline = '';
            }
        }

        /**
         * Generates a robust and specific CSS selector for a given DOM element.
         * Prioritizes stable attributes (`data-testid`, `id`) before falling back to a
         * path-based selector with escaped class names and `nth-of-type` for precision.
         * Escaping is critical to handle modern CSS frameworks (e.g., Tailwind).
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

        // --- Publicly Exposed Methods of the Picker Module ---

        /** Activates the element picker mode, adding all necessary event listeners. */
        function activate() {
            if (isPickerModeActive) return;
            isPickerModeActive = true;
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mouseover', throttledMouseOver);
            document.addEventListener('mouseout', handleMouseOut);
            document.addEventListener('keydown', handleKeydownCancel, { capture: true });
            document.addEventListener('mousedown', handleMouseAction, { capture: true });
            logger.log('Picker mode ACTIVATED.');
        }

        /** Deactivates the element picker mode, cleaning up all event listeners. */
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
            logger.log('Picker mode DEACTIVATED.');
        }

        return { activate, deactivate, isActive: () => isPickerModeActive };
    })();

    // --- 4. Main Execution and Event Handling ---
    
    // Original auto-clicker for legacy support on specific sites.
    function checkInitialElement(targetSelector, actionCallback) { document.querySelectorAll(targetSelector).forEach(actionCallback); }
    function clickTargetElement(targetElement) { targetElement.click(); }

    /** Initializes the extension's state on page load. */
    async function initialize() {
        try {
            const result = await chrome.storage.local.get(['selectors', 'isPersistenceEnabled']);
            const shouldPersist = result.isPersistenceEnabled !== false;
            if (shouldPersist && result.selectors && result.selectors.length > 0) {
                updateHiddenElements(result.selectors);
            }
        } catch (error) {
            logger.error("Failed to initialize.", error);
        }
        checkInitialElement('.btn.btn-skip', clickTargetElement);
    }
    
    /**
     * Reverts the last element hidden by the picker tool.
     * It pops the last-added selector from the session history stack, removes it
     * from the master list in `chrome.storage.local`, and updates the page styles.
     * @returns {Promise<void>}
     */
    async function revertLastAction() {
        if (pickerActionHistory.length === 0) {
            logger.warn("No actions in session history to revert.");
            return;
        }
        const selectorToRevert = pickerActionHistory.pop();
        logger.log("Reverting selector:", selectorToRevert);
        try {
            const result = await chrome.storage.local.get({ selectors: [] });
            const newSelectors = (result.selectors || []).filter(s => s !== selectorToRevert);
            await chrome.storage.local.set({ selectors: newSelectors });
            updateHiddenElements(newSelectors);
        } catch (error) {
            logger.error("Error during revert action:", error);
            pickerActionHistory.push(selectorToRevert); // Push back on failure.
        }
    }

    /**
     * Main message listener for commands from `background.js` (hotkeys) and `popup.js`.
     */
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateSelectors') {
            pickerActionHistory = []; // Manual update from popup clears session history.
            logger.log("Session history cleared due to manual update from popup.");
            updateHiddenElements(request.selectors);
            sendResponse({ status: "Selectors updated and history cleared" });
        } else if (request.action === 'togglePickerMode') {
            Picker.isActive() ? Picker.deactivate() : Picker.activate();
            sendResponse({ status: "Picker mode toggled" });
        } else if (request.action === 'revertLastAction') {
            revertLastAction();
            sendResponse({ status: "Revert action triggered" });
        }
        return true; // Indicates an asynchronous response may be sent.
    });

    // --- 5. MutationObserver for SPA Compatibility ---
    /**
     * Starts a MutationObserver to handle dynamically loaded content on Single Page Applications (SPAs).
     * This ensures that hiding rules are re-applied when the user navigates within a site
     * without a full page reload. It is debounced to avoid performance issues.
     */
    function startMutationObserver() {
        let debounceTimeout;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(async () => {
                logger.log('DOM changed (debounced), re-applying rules.');
                try {
                    const result = await chrome.storage.local.get(['selectors', 'isPersistenceEnabled']);
                    if (result.isPersistenceEnabled !== false && result.selectors?.length > 0) {
                        updateHiddenElements(result.selectors);
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