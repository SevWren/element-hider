/**
 * @fileoverview Content script for the Element Hider Chrome extension.
 * This script is the core engine of the extension, injected into all web pages as defined in `manifest.json`.
 * It is responsible for all direct DOM manipulation, including:
 * 1. Injecting CSS rules to hide elements based on user-defined selectors.
 * 2. Managing the interactive "Element Picker" feature, including highlighting and DOM traversal.
 * 3. Observing the DOM for changes to re-apply rules on Single Page Applications (SPAs).
 * 4. Communicating with `background.js` (for hotkeys) and `popup.js` (for selector updates).
 *
 * @version 1.0
 * @author TM Soontornsing
 */
(function () {
  "use strict";

  /**
   * The entire script is wrapped in an Immediately Invoked Function Expression (IIFE).
   * This creates a private scope, preventing its variables and functions (`DEBUG`, `logger`, `Picker`, etc.)
   * from polluting the global `window` object of the web page it's injected into. This is a critical
   * best practice for content scripts to avoid conflicts with the page's own JavaScript.
   */

  /**
   * Global flag to enable or disable verbose logging for development.
   * Set to `false` in production builds to keep the console clean for end-users.
   * @type {boolean}
   */
  const DEBUG = false;

  /**
   * A namespaced logger utility to standardize console output and control verbosity.
   * It respects the `DEBUG` flag for non-critical messages.
   * @type {{log: function, warn: function, error: function}}
   */
  const logger = {
    log: (...args) => DEBUG && console.log("Element Hider:", ...args),
    warn: (...args) => DEBUG && console.warn("Element Hider:", ...args),
    error: (...args) => console.error("Element Hider:", ...args),
  };

  /**
   * A robust guard to check if the extension context is still valid. This is crucial for
   * preventing "Extension context invalidated" errors that occur when an async callback
   * (from setTimeout, an event listener, or MutationObserver) tries to access a `chrome.*` API
   * after the extension has been reloaded or disabled.
   * @returns {boolean} True if the context is valid and APIs can be safely called, false otherwise.
   */
  function isContextValid() {
    try {
      // Accessing chrome.runtime.id will throw an error if the context is invalidated.
      return chrome.runtime?.id !== undefined;
    } catch (e) {
      return false;
    }
  }

  /**
   * Extracts the current hostname from `window.location.hostname`. This value is used as the
   * key for storing and retrieving selectors in `chrome.storage.local`, ensuring rules are
   * specific to the exact hostname (e.g., 'www.example.com' is distinct from 'app.example.com').
   * It includes a special case for local files.
   * @returns {string} The hostname of the current page, or 'file://' for local files.
   */
  function getCurrentDomain() {
    if (window.location.protocol === "file:") {
      return "file://";
    }
    return window.location.hostname;
  }

  /**
   * A session-specific history stack for the element picker tool.
   * This acts as a Last-In, First-Out (LIFO) stack, tracking only the CSS selectors
   * added via the hotkey-activated Element Picker within the current page session.
   * It is exclusively used by the `revertLastAction` feature (`Ctrl+Shift+Z`).
   *
   * IMPORTANT: This history is volatile. It is cleared whenever the page is reloaded or
   * when a manual update is made from the popup UI, as that action is considered a new
   * source of truth for the page's selectors.
   * @type {Array<string>}
   */
  let pickerActionHistory = [];

  /**
   * Injects or updates a `<style>` tag in the document's `<head>` to hide elements.
   * This function uses a "nuke and pave" approach: it completely removes any pre-existing
   * style tag managed by this extension before creating a new one. This ensures maximum
   * compatibility with modern frameworks (like React or Vue) that might ignore simple
   * `textContent` updates to a "zombie" style tag that they don't control.
   * @param {string[]} selectors - An array of CSS selectors for elements to be hidden.
   * @returns {void}
   */
  function updateHiddenElements(selectors) {
    let style = document.getElementById("element-hider-style");
    if (style) {
      style.remove();
    }
    if (!selectors || selectors.length === 0) {
      return;
    }
    style = document.createElement("style");
    style.id = "element-hider-style";
    const cssRules = selectors
      .map((selector) => `${selector} { display: none !important; }`)
      .join("\n");
    style.textContent = cssRules;
    document.head.appendChild(style);
  }

  /**
   * A self-contained module encapsulating all logic for the Element Picker feature.
   * It follows the IIFE module pattern to create a private scope for its state
   * (`isPickerModeActive`, `highlightElement`, etc.) and internal functions, exposing
   * only a clean public API (`activate`, `deactivate`, `isActive`).
   * @returns {{activate: function, deactivate: function, isActive: function}} The public API for controlling the picker.
   */
  const Picker = (function () {
    /** @private @type {boolean} The current activation state of the picker. */
    let isPickerModeActive = false;
    /** @private @type {?Element} The DOM element currently highlighted by the picker. */
    let highlightElement = null;
    /** @private @type {Element[]} A LIFO stack to track upward DOM traversal for bidirectional scrolling. */
    let traversalHistory = [];

    /**
     * @private
     * @description Throttles a function to limit its execution rate, essential for performance on high-frequency events.
     * @param {function} func - The function to throttle.
     * @param {number} limit - The minimum time in milliseconds between executions.
     * @returns {function} The new throttled function.
     */
    function throttle(func, limit) {
      let inThrottle;
      return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
          func.apply(context, args);
          inThrottle = true;
          setTimeout(() => (inThrottle = false), limit);
        }
      };
    }

    /**
     * @private
     * @description Event handler to cancel picker mode upon any key press.
     * @param {KeyboardEvent} event - The keyboard event object.
     */
    function handleKeydownCancel(event) {
      event.preventDefault();
      event.stopPropagation();
      logger.log(`Key press (${event.key}) detected. Cancelling selection.`);
      deactivate();
    }

    /**
     * @private
     * @async
     * @description Unified mouse event handler for confirming a selection. It generates a selector for the
     * clicked element, saves it to storage, and applies the new hiding rule. Using `mousedown` is more
     * reliable than `click` on complex websites that may stop event propagation.
     * @param {MouseEvent} event - The mouse event object.
     */
    async function handleMouseAction(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) {
        logger.log(
          `Mouse button ${event.button} press detected. Cancelling selection.`
        );
        deactivate();
        return;
      }

      logger.log("Left mouse press CONFIRMED selection.");
      const clickedElement = event.target;
      const selector = generateSelector(clickedElement);

      try {
        if (!isContextValid()) return; // GUARD
        const result = await chrome.storage.local.get({ selectors: {} });
        const allSelectors = result.selectors || {};
        const currentDomain = getCurrentDomain();
        const domainSelectors = allSelectors[currentDomain] || [];

        if (!domainSelectors.includes(selector)) {
          const newDomainSelectors = [...domainSelectors, selector];
          allSelectors[currentDomain] = newDomainSelectors;
          await chrome.storage.local.set({ selectors: allSelectors });
          updateHiddenElements(newDomainSelectors);
          pickerActionHistory.push(selector);
          logger.log(
            "Selector saved and applied for domain:",
            currentDomain,
            selector
          );
        } else {
          logger.log(
            "Selector already exists for domain:",
            currentDomain,
            selector
          );
        }
      } catch (error) {
        if (isContextValid()) {
          logger.error("An error occurred while handling the click.", error);
        }
      } finally {
        deactivate();
      }
    }

    /**
     * @private
     * @description Throttled event handler for the mouse wheel. Enables bidirectional DOM traversal.
     * Scrolling up (`deltaY < 0`) moves the highlight to the parent element.
     * Scrolling down (`deltaY > 0`) moves back to the previously visited child element.
     * @param {WheelEvent} event - The wheel event object.
     */
    const handleWheel = throttle((event) => {
      event.preventDefault();
      if (!highlightElement || !isPickerModeActive) return;

      if (event.deltaY < 0) {
        // Scrolling UP
        const parent = highlightElement.parentElement;
        if (parent && parent !== document.documentElement) {
          traversalHistory.push(highlightElement); // Save current element before moving up
          highlightElement.style.outline = "";
          highlightElement = parent;
          highlightElement.style.outline = "2px solid #e60000";
        }
      } else if (event.deltaY > 0) {
        // Scrolling DOWN
        if (traversalHistory.length > 0) {
          const child = traversalHistory.pop(); // Get the last element we came from
          highlightElement.style.outline = "";
          highlightElement = child;
          highlightElement.style.outline = "2px solid #e60000";
        }
      }
    }, 100);

    /**
     * @private
     * @description Throttled event handler for mouse movement. Highlights the element under the cursor.
     * CRITICAL: It also resets the `traversalHistory` whenever the mouse moves to a new element,
     * ensuring that each scroll interaction starts from a clean, intuitive state.
     * @param {MouseEvent} event - The mouseover event object.
     */
    const throttledMouseOver = throttle((event) => {
      if (highlightElement) {
        highlightElement.style.outline = "";
      }
      highlightElement = event.target;
      highlightElement.style.outline = "2px solid #e60000";
      traversalHistory = []; // Reset history on new hover
    }, 50);

    /**
     * @private
     * @description Event handler to clear the highlight when the mouse leaves a highlighted element.
     * @param {MouseEvent} event - The mouseout event object.
     */
    function handleMouseOut(event) {
      if (event.target && event.target === highlightElement) {
        highlightElement.style.outline = "";
        highlightElement = null;
      }
    }

    /**
     * @private
     * @description Generates a robust and specific CSS selector for a given DOM element.
     * The strategy prioritizes stability:
     * 1. Stable test attributes (`data-testid`, `data-cy`, etc.).
     * 2. The element's `id`.
     * 3. A highly specific path-based selector using tag names, escaped class names, and `:nth-of-type`
     *    as a fallback. This is designed to be resilient against dynamic class names from frameworks.
     * @param {Element} el - The DOM element to generate a selector for.
     * @returns {string} The generated CSS selector.
     */
    function generateSelector(el) {
      const escapeCSS = (str) => {
        if (typeof str !== "string") return "";
        return str.replace(/([#;&,.+*~':"!^$\[\]()<=>|/])/g, "\\$1");
      };
      const stableAttrs = [
        "data-testid",
        "data-cy",
        "data-test",
        "name",
        "aria-label",
      ];
      for (const attr of stableAttrs) {
        const attrValue = el.getAttribute(attr);
        if (attrValue)
          return `${el.tagName.toLowerCase()}[${attr}="${attrValue}"]`;
      }
      if (el.id) return `#${escapeCSS(el.id)}`;
      let path = [];
      let current = el;
      while (current.parentElement) {
        let segment = current.tagName.toLowerCase();
        const stableClasses = Array.from(current.classList)
          .filter((c) => !/hover|active|focus/.test(c))
          .map((c) => `.${escapeCSS(c)}`)
          .join("");
        if (stableClasses) segment += stableClasses;
        const siblings = Array.from(current.parentElement.children);
        const sameTagSiblings = siblings.filter(
          (s) => s.tagName === current.tagName
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
        path.unshift(segment);
        current = current.parentElement;
      }
      return path.join(" > ");
    }

    /**
     * @public
     * @description Activates the element picker mode, setting the cursor and attaching all necessary event listeners.
     */
    function activate() {
      if (isPickerModeActive) return;
      isPickerModeActive = true;
      traversalHistory = [];
      document.body.style.cursor = "crosshair";
      document.addEventListener("mouseover", throttledMouseOver);
      document.addEventListener("mouseout", handleMouseOut);
      document.addEventListener("keydown", handleKeydownCancel, {
        capture: true,
      });
      document.addEventListener("mousedown", handleMouseAction, {
        capture: true,
      });
      document.addEventListener("wheel", handleWheel, {
        capture: true,
        passive: false,
      });
      logger.log("Picker mode ACTIVATED.");
    }

    /**
     * @public
     * @description Deactivates the picker mode, restoring the cursor and cleaning up all event listeners to prevent memory leaks.
     */
    function deactivate() {
      if (!isPickerModeActive) return;
      isPickerModeActive = false;
      document.body.style.cursor = "default";
      if (highlightElement) {
        highlightElement.style.outline = "";
        highlightElement = null;
      }
      document.removeEventListener("mouseover", throttledMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("keydown", handleKeydownCancel, {
        capture: true,
      });
      document.removeEventListener("mousedown", handleMouseAction, {
        capture: true,
      });
      document.removeEventListener("wheel", handleWheel, { capture: true });
      logger.log("Picker mode DEACTIVATED.");
    }

    return { activate, deactivate, isActive: () => isPickerModeActive };
  })();

  /**
   * @async
   * @description Initializes the extension's state on page load. It checks if persistence is
   * enabled and, if so, fetches the selectors for the current domain from storage and
   * applies them by calling `updateHiddenElements`.
   * @returns {Promise<void>}
   */
  async function initialize() {
    try {
      if (!isContextValid()) return; // GUARD
      const result = await chrome.storage.local.get([
        "selectors",
        "isPersistenceEnabled",
      ]);
      const shouldPersist = result.isPersistenceEnabled !== false;
      const currentDomain = getCurrentDomain();
      const domainSelectors = result.selectors?.[currentDomain] || [];
      if (shouldPersist && domainSelectors.length > 0) {
        updateHiddenElements(domainSelectors);
      }
    } catch (error) {
      if (isContextValid()) {
        logger.error("Failed to initialize.", error);
      }
    }
  }

  /**
   * @async
   * @description Reverts the last element hidden by the picker tool. It pops the last-added
   * selector from the `pickerActionHistory` session stack, removes it from the master list in
   * `chrome.storage.local`, and updates the page styles.
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
      if (!isContextValid()) {
        // GUARD
        pickerActionHistory.push(selectorToRevert); // Push back if we can't save
        return;
      }
      const result = await chrome.storage.local.get({ selectors: {} });
      const allSelectors = result.selectors || {};
      const currentDomain = getCurrentDomain();
      let domainSelectors = allSelectors[currentDomain] || [];
      const newDomainSelectors = domainSelectors.filter(
        (s) => s !== selectorToRevert
      );

      if (newDomainSelectors.length === 0) {
        delete allSelectors[currentDomain];
      } else {
        allSelectors[currentDomain] = newDomainSelectors;
      }
      await chrome.storage.local.set({ selectors: allSelectors });
      updateHiddenElements(newDomainSelectors);
    } catch (error) {
      pickerActionHistory.push(selectorToRevert); // Push back on any failure
      if (isContextValid()) {
        logger.error("Error during revert action:", error);
      }
    }
  }

  /**
   * @listens chrome.runtime.onMessage
   * @description Main message listener for commands from other parts of the extension.
   * - `updateSelectors`: Received from `popup.js` to apply a new set of rules.
   * - `togglePickerMode`: Received from `background.js` via a hotkey to activate/deactivate the picker.
   * - `revertLastAction`: Received from `background.js` via a hotkey to undo the last picker action.
   * @param {object} request - The message object.
   * @param {object} sender - Information about the script that sent the message.
   * @param {function} sendResponse - Function to call to send a response.
   * @returns {boolean} Returns `true` to indicate that `sendResponse` will be called asynchronously.
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isContextValid()) {
      // GUARD
      logger.log("Context invalidated. Ignoring message:", request.action);
      return;
    }

    if (request.action === "updateSelectors") {
      pickerActionHistory = [];
      logger.log("Session history cleared due to manual update from popup.");
      const currentDomain = getCurrentDomain();
      const domainSelectors = request.selectors?.[currentDomain] || [];
      updateHiddenElements(domainSelectors);
      sendResponse({ status: "Selectors updated and history cleared" });
    } else if (request.action === "togglePickerMode") {
      Picker.isActive() ? Picker.deactivate() : Picker.activate();
      sendResponse({ status: "Picker mode toggled" });
    } else if (request.action === "revertLastAction") {
      revertLastAction();
      sendResponse({ status: "Revert action triggered" });
    }
    return true;
  });

  /**
   * @description Starts a MutationObserver to handle dynamically loaded content on Single Page Applications (SPAs).
   * This ensures that hiding rules are re-applied when the user navigates within a site
   * without a full page reload. It is debounced to avoid performance issues on pages with
   * frequent DOM changes.
   * @returns {void}
   */
  function startMutationObserver() {
    let debounceTimeout;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(async () => {
        if (!isContextValid()) {
          // PRIMARY FIX IS HERE
          logger.log("MutationObserver stopped: Context became invalid.");
          observer.disconnect(); // Stop observing to prevent future errors
          return;
        }

        logger.log("DOM changed (debounced), re-applying rules.");
        try {
          const result = await chrome.storage.local.get([
            "selectors",
            "isPersistenceEnabled",
          ]);
          if (result.isPersistenceEnabled !== false) {
            const currentDomain = getCurrentDomain();
            const domainSelectors = result.selectors?.[currentDomain] || [];
            updateHiddenElements(domainSelectors);
          }
        } catch (error) {
          if (isContextValid()) {
            logger.error("Error re-applying rules in MutationObserver.", error);
          }
        }
      }, 300);
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      logger.log("MutationObserver started.");
    }
  }

  // --- Initial Kick-off ---
  initialize();
  startMutationObserver();
})();
