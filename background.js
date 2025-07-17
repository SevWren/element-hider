/**
 * @fileoverview Background script for the Element Hider Chrome extension.
 * This script serves as the extension's event handler for keyboard shortcuts and manages
 * communication between the browser action and content scripts.
 * 
 * 
 * Handles keyboard commands from the extension and forwards them to the active tab's content script.
 * This is the main entry point for all keyboard-triggered actions in the extension.
 * 
 * @listens chrome.commands.onCommand
 * @param {string} command - The command identifier that was triggered
 * @param {chrome.tabs.Tab} tab - The active tab object where the command was triggered
 * @returns {void}
 * 
 * @example
 * // Example of handling the toggle picker mode command
 * chrome.commands.onCommand.addListener((command, tab) => {
 *   if (command === 'toggle-picker-mode') {
 *     // Handle picker mode toggle
 *   }
 * });
 *
 */

chrome.commands.onCommand.addListener((command, tab) => {

  /**
   * Only proceed if we have a valid tab ID
   * @type {boolean}
   */

  if (tab.id) {
  
    /**
     * Maps the command string to the corresponding action identifier
     * @type {string}
     */
  
    let action = '';
    
    if (command === "toggle-picker-mode") {
      action = 'togglePickerMode';
    } else if (command === "revert-last-action") {
      action = 'revertLastAction';
    }

    /**
     * If we have a valid action, send it to the content script
     * @type {boolean}
     */
  
    if (action) {
      chrome.tabs.sendMessage(tab.id, { action: action }, (response) => {
  
        /**
         * Handle potential errors when sending message to content script
         * Common scenarios:
         * - Content script not loaded (e.g., on chrome:// pages)
         * - Tab has been closed
         * - Page has been reloaded
         */
  
        if (chrome.runtime.lastError) {
          console.warn(`Element Hider: Could not connect to the content script for action '${action}'. Please reload the page and try again if this was on a regular website.`);
        } else {
          console.log(`Response from content script for '${action}':`, response);
        }
      });
    }
  }
});