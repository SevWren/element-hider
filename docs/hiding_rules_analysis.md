Of course. As the lead developer for "Element Hider: TM's Masterpiece," I've analyzed this issue in detail. You've uncovered a subtle but critical bug stemming from how the extension identifies a "domain." The core problem is that the logic to shorten a hostname (e.g., `www.myanime.live` -> `myanime.live`) is fragile and can lead to inconsistencies.

Here is a painstaking, detailed analysis of the fix, which involves making the domain matching more strict and predictable, and also correcting two other related bugs I've identified during this deep dive.

### **Painsktaking Analysis of the Root Cause**

1.  **The Flawed "Domain Guessing" Logic**: Both `content.js` (in `getCurrentDomain`) and `popup.js` (in `getCurrentDomainFromActiveTab`) use the following code to determine the storage key:
    ```javascript
    const parts = hostname.split('.');
    if (parts.length > 1) {
      return parts.slice(-2).join('.');
    }
    ```
    While this works for simple cases like `www.example.com` -> `example.com`, it's not robust. It fails for country-code top-level domains (e.g., `www.site.co.uk` would incorrectly become `co.uk`) and can cause unpredictable behavior. The most reliable solution is to **use the full `hostname` as the key**. This means rules for `www.example.com` will be separate from `app.example.com`, which is more predictable and less error-prone. This change will fix the issue you are seeing on `myanime.live`.

2.  **Bug #2: Faulty Real-Time Update**: The `saveButton` in `popup.js` sends a message to `content.js` with only the *array* of selectors for the current domain. However, the message listener in `content.js` expects the *entire `selectors` object* from storage and tries to look up the domain within it (`request.selectors?.[currentDomain]`). This fails, meaning the "Save and Apply" button doesn't apply styles in real-time; they only appear after a page reload when `initialize()` reads from storage correctly. We must fix `popup.js` to send the correct data structure.

3.  **Bug #3: Faulty SPA Navigation Update**: The `MutationObserver` in `content.js`, designed to re-apply rules on Single Page Applications, has a critical bug. It calls `updateHiddenElements(result.selectors)`, passing the entire storage object instead of just the array for the current domain. This must be corrected to `updateHiddenElements(result.selectors[currentDomain])` to work correctly.

### **The Complete Fix: Modified Files**

To resolve this, you need to modify two files: `content.js` and `popup.js`. Below are the complete contents for each modified file.

---

### **1. `content.js` (Modified)**

**Summary of Changes:**
*   **`getCurrentDomain()`**: This function is simplified to return the exact `window.location.hostname`. This is the primary fix for your issue.
*   **`chrome.runtime.onMessage` listener**: The logic for `'updateSelectors'` is now corrected to properly read the data sent from the updated `popup.js`.
*   **`startMutationObserver()`**: The debounced callback is fixed to correctly find the selectors for the current domain and pass the correct array to `updateHiddenElements`.

```javascript
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
     * Extracts the current hostname from `window.location.hostname`.
     * This is used as the key for storing and retrieving selectors, ensuring rules are
     * specific to the exact hostname (e.g., 'www.example.com' is distinct from 'app.example.com').
     * @returns {string} The hostname of the current page.
     */
    function getCurrentDomain() {
        if (window.location.protocol === 'file:') {
            return 'file://'; // Special case for local files
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
                    pickerActionHistory.push(selector); // Add to session history for revert feature.
                    logger.log('Selector saved and applied for domain:', currentDomain, selector);
                } else {
                    logger.log('Selector already exists for domain:', currentDomain, selector);
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
            const currentDomain = getCurrentDomain();
            const domainSelectors = result.selectors?.[currentDomain] || [];

            if (shouldPersist && domainSelectors.length > 0) {
                updateHiddenElements(domainSelectors);
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
            const currentDomain = getCurrentDomain();
            // The `request.selectors` is now the full object, so we look up the current domain's selectors
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
                    const currentDomain = getCurrentDomain(); // Get the domain within the callback
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

---

### **2. `popup.js` (Modified)**

**Summary of Changes:**
*   **`getCurrentDomainFromActiveTab()`**: This function is updated to return the exact `hostname` from the tab's URL, matching the new logic in `content.js`.
*   **`saveButton` click listener**: The `chrome.tabs.sendMessage` call is modified to send the entire `allSelectors` object instead of just the local `selectors` array. This fixes the real-time update bug.
*   **`clearAllButton` click listener**: The message sent to `content.js` is corrected to send the entire updated `allSelectors` object, ensuring the page visually updates correctly when clearing rules.

```javascript
/**
 * @fileoverview Script for the Element Hider extension's popup UI (popup.html).
 *
 * This script handles all user interactions within the popup, including:
 * - Loading and managing presets from `preset.json`.
 * - Loading and displaying saved selectors from `chrome.storage`.
 * - Handling user input in the textarea.
 * - Saving settings and selectors to `chrome.storage`.
 * - Communicating with the `content.js` script on the active tab to apply changes in real-time.
 */

/**
 * Main initialization function that runs when the popup's DOM is fully loaded.
 * It sets up all necessary event listeners and loads the initial state from storage and presets.
 * @listens DOMContentLoaded
 */

/**
     * Gets the current hostname from the active tab.
     * @async
     * @returns {Promise<string>} The hostname of the active tab's URL, or a special identifier.
     */
    async function getCurrentDomainFromActiveTab() {
        return new Promise(resolve => {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (tabs.length > 0 && tabs[0].url) {
                    try {
                        const url = new URL(tabs[0].url);
                        if (url.protocol === 'chrome:') {
                            resolve('chrome-internal');
                        } else if (url.protocol === 'file:') {
                            resolve('file://'); // Using 'file://' for consistency with content.js
                        } else {
                            // Using the full hostname is more reliable than guessing the registrable domain.
                            resolve(url.hostname);
                        }
                    } catch (e) {
                        console.error('Error parsing URL:', e);
                        resolve('unknown-domain');
                    }
                } else {
                    resolve('no-active-tab');
                }
            });
        });
    }
document.addEventListener('DOMContentLoaded', () => {
    /** @type {Array<{name: string, selectors: string[]}>|null} */
    let presets = null;
    const selectorsArea = document.getElementById('selectors');
    const selectElement = document.getElementById('preset-select');
    const saveButton = document.getElementById('save');
    const persistCheckbox = document.getElementById('persist-checkbox');
    // Get the new "Clear All" button
    const clearAllButton = document.getElementById('clear-all');

    /**
     * Fetches and loads presets from the preset.json file.
     * Populates the preset dropdown with the loaded presets.
     * @async
     * @returns {Promise<void>}
     */
    fetch('preset.json')
      .then(response => response.json())
      .then(data => {
        presets = data.presets;
        // Populate the dropdown with presets
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name;
            selectElement.appendChild(option);
        });
      })
      .catch(error => console.error('Error loading presets:', error));

    /**
     * Loads saved user data (selectors and persistence setting) when the popup opens.
     * @param {Object} result - The saved data from Chrome's storage
     * @returns {void}
     */
    // Load saved user data (selectors and persistence setting) when the popup opens.
    // Expects 'selectors' to be an object with domain keys.
    getCurrentDomainFromActiveTab().then(currentDomain => {
        chrome.storage.local.get(['selectors', 'isPersistenceEnabled'], result => {
            const allSelectors = result.selectors || {};
            const domainSelectors = allSelectors[currentDomain] || [];
            selectorsArea.value = domainSelectors.join('\n');

            // Default to 'true' (checked) if the setting has never been saved
            persistCheckbox.checked = result.isPersistenceEnabled !== false;
        });
    });

    /**
     * Handles changes to the persistence checkbox.
     * Saves the new persistence setting to Chrome's storage.
     * @listens change
     * @returns {void}
     */
    persistCheckbox.addEventListener('change', () => {
        // Save the new state whenever it's toggled
        chrome.storage.local.set({ isPersistenceEnabled: persistCheckbox.checked });
    });

    /**
     * Handles the "Clear All" button click.
     * Confirms with the user before clearing all saved selectors.
     * @listens click
     * @returns {void}
     */
    clearAllButton.addEventListener('click', () => {
        // Use a confirmation dialog to prevent accidental deletion of all data
        if (confirm('Are you sure you want to permanently delete all saved selectors for this specific hostname? This cannot be undone.')) {
            
            getCurrentDomainFromActiveTab().then(currentDomain => {
                chrome.storage.local.get(['selectors'], result => {
                    const allSelectors = result.selectors || {};
                    delete allSelectors[currentDomain]; // Remove selectors for the current domain

                    chrome.storage.local.set({ selectors: allSelectors }, () => {
                        selectorsArea.value = ''; // Clear the textarea
                        console.log(`Selectors for ${currentDomain} have been cleared.`);

                        // Send the updated full selectors object to content.js to clear styles for the current tab
                        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                            if (tabs.length > 0) {
                                chrome.tabs.sendMessage(tabs[0].id, {
                                    action: 'updateSelectors',
                                    selectors: allSelectors // Send the whole modified object
                                });
                            }
                        });
                    });
                });
            });
        }
    });

    /**
     * Handles changes to the preset dropdown.
     * Loads the selected preset's selectors into the textarea.
     * @listens change
     * @param {Event} event - The change event
     * @returns {void}
     */
    selectElement.addEventListener('change', event => {
        const selectedPreset = presets?.find(p => p.name === event.target.value);
        if (selectedPreset) {
          selectorsArea.value = selectedPreset.selectors.join('\n');
        }
    });

    /**
     * Handles the "Save and Apply" button click.
     * Saves the current selectors to storage and applies them to the current page.
     * @listens click
     * @returns {void}
     */
    saveButton.addEventListener('click', () => {
        const selectorsText = selectorsArea.value;
        const selectors = selectorsText.split('\n').map(s => s.trim()).filter(s => s.length > 0);

        // UI feedback for saving
        saveButton.textContent = 'Saving...';
        saveButton.classList.add('saving');
        saveButton.disabled = true;

        getCurrentDomainFromActiveTab().then(currentDomain => {
            chrome.storage.local.get(['selectors'], result => {
                const allSelectors = result.selectors || {};
                allSelectors[currentDomain] = selectors; // Update selectors for the current domain

                // Save the modified selectors object to storage
                chrome.storage.local.set({ selectors: allSelectors }, () => {
                    // Notify the active tab to apply the new rules immediately
                    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                        if (tabs.length > 0) {
                            // Send the ENTIRE selectors object so content.js can find what it needs
                            chrome.tabs.sendMessage(tabs[0].id, { action: 'updateSelectors', selectors: allSelectors }, () => {
                                // Restore button state after completion
                                saveButton.classList.remove('saving');
                                saveButton.classList.add('success');
                                saveButton.textContent = 'Saved!';
                                setTimeout(() => {
                                    saveButton.textContent = 'Save and Apply';
                                    saveButton.classList.remove('success');
                                    saveButton.disabled = false;
                                }, 1500);
                            });
                        }
                    });
                });
            });
        });
    });
});
```

### **Instructions to Apply the Fix**

1.  **Replace the Files**: Open your project's `element-hider` directory. Completely replace the contents of `content.js` and `popup.js` with the corresponding code blocks provided above.
2.  **Reload the Extension**:
    *   Open Chrome and navigate to `chrome://extensions`.
    *   Find **"Element Hider: TM's Masterpiece"** in your list of extensions.
    *   Click the "Reload" button (it looks like a circular arrow).

After reloading, the extension will use the more robust hostname-based logic. You will need to re-add the selectors for `myanime.live`, but this time they will be saved under the full hostname and will apply consistently across all pages of that specific hostname. This change makes the extension's behavior far more reliable and predictable.