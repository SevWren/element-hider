/**
 * @fileoverview Content script for the Element Hider Chrome extension.
 * This script runs in web pages and handles the actual element hiding functionality.
 */

/**
 * This script is wrapped in an immediately invoked function expression (IIFE) to prevent variables
 * and functions from leaking into the global scope. This is a good practice to follow when writing
 * JavaScript that will be executed in an environment not under your control (like a web page).
 * Wrapping the entire  function in  () achieves this. 
 * The IIFE ensures that any variables or functions you declare inside it will not be accessible
 * from outside the script, which helps prevent conflicts with other scripts that might be running
 * on the same page.
 */

(function() {
  'use strict';

  /**
   * Global configuration object
   * @type {Object}
   */

  const DEBUG = false; // Set to false for production to disable non-error logs.

  /**
   * Logger utility with different log levels
   * @type {Object}
   * @property {Function} log - Debug logging (only in development)
   * @property {Function} warn - Warning logging (only in development)
   * @property {Function} error - Error logging (always enabled)
   */

  const logger = {
      log: (...args) => DEBUG && console.log('Element Hider:', ...args),
      warn: (...args) => DEBUG && console.warn('Element Hider:', ...args),
      error: (...args) => console.error('Element Hider:', ...args), // Always show errors.
  };

  /**
   * History stack for picker tool actions in the current session
   * @type {Array<string>}
   * @description Tracks selectors added via the picker tool, not from popup textarea
   */
  
  let pickerActionHistory = [];

  /**
   * Core function to update hidden elements on the page
   * @param {Array<string>} selectors - CSS selectors to hide
   * @returns {void}
   * @description
   * This function ensures robust element hiding by:
   * 1. Removing any existing style tag to prevent "zombie" tags
   * 2. Creating a new style tag only if selectors exist
   * 3. Using !important to override other styles
   * 4. Appending to head to ensure proper loading order
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

  // --- 3. Picker Mode Logic Encapsulated in a Module (IIFE) ---
  const Picker = (function() {
      let isPickerModeActive = false;
      let highlightElement = null;

      // Utility: Throttle function to improve performance.
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

      // Event Handlers
      function handleKeydownCancel(event) {
          event.preventDefault();
          event.stopPropagation();
          logger.log(`Key press (${event.key}) detected. Cancelling selection.`);
          deactivate();
      }

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
              const result = await chrome.storage.local.get({ selectors: [] });
              const existingSelectors = result.selectors || [];

              if (!existingSelectors.includes(selector)) {
                  const newSelectors = [...existingSelectors, selector];
                  await chrome.storage.local.set({ selectors: newSelectors });
                  updateHiddenElements(newSelectors);
                  
                  // Push the successfully added selector to our session history.
                  pickerActionHistory.push(selector);
                  logger.log('Selector saved and applied:', selector);

              } else {
                  logger.log('Selector already exists.');
              }
          } catch (error) {
              logger.error("An error occurred while handling the click.", error);
          } finally {
              // Deactivate the picker mode AFTER everything is done.
              deactivate();
          }
      }
      
      const throttledMouseOver = throttle((event) => {
          if (highlightElement) {
              highlightElement.style.outline = '';
          }
          highlightElement = event.target;
          highlightElement.style.outline = '2px solid #e60000';
      }, 50); // Throttle mouseover to max once every 50ms.

      function handleMouseOut(event) {
          if (event.target) {
              event.target.style.outline = '';
          }
      }

      // Enhanced Selector Generation with CSS character escaping
      function generateSelector(el) {
          const escapeCSS = (str) => {
              if (typeof str !== 'string') return '';
              return str.replace(/([#;&,.+*~':"!^$\[\]()<=>|/])/g, '\\$1');
          };

          const stableAttrs = ['data-testid', 'data-cy', 'data-test', 'name', 'aria-label'];
          for (const attr of stableAttrs) {
              const attrValue = el.getAttribute(attr);
              if (attrValue) {
                  return `${el.tagName.toLowerCase()}[${attr}="${attrValue}"]`;
              }
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
            
            if (stableClasses) { 
                segment += stableClasses;
            }

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

      // Public Methods
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

      return {
          activate,
          deactivate,
          isActive: () => isPickerModeActive
      };
  })();

  // --- 4. Main Execution Logic ---
  
  // Original auto-clicker for legacy support
  function checkInitialElement(targetSelector, actionCallback) { document.querySelectorAll(targetSelector).forEach(actionCallback); }
  function clickTargetElement(targetElement) { targetElement.click(); }

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
  
  async function revertLastAction() {
      if (pickerActionHistory.length === 0) {
          logger.warn("No actions in session history to revert.");
          return;
      }

      const selectorToRevert = pickerActionHistory.pop();
      logger.log("Reverting selector:", selectorToRevert);

      try {
          const result = await chrome.storage.local.get({ selectors: [] });
          const currentSelectors = result.selectors || [];
          
          const newSelectors = currentSelectors.filter(s => s !== selectorToRevert);

          await chrome.storage.local.set({ selectors: newSelectors });
          updateHiddenElements(newSelectors);
      } catch (error) {
          logger.error("Error during revert action:", error);
          pickerActionHistory.push(selectorToRevert); // Push back on failure to allow retry
      }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'updateSelectors') {
          pickerActionHistory = []; // A manual update from the popup clears the session history.
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
      return true;
  });

  // --- 5. MutationObserver for SPA Compatibility ---
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

  // Run initialization and start observers
  initialize();
  startMutationObserver();

})();