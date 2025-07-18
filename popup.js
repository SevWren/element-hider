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
     * Gets the current hostname from the active tab. This is the key for storage.
     * @async
     * @returns {Promise<string>} The hostname of the active tab's URL (e.g., 'www.example.com').
     */
async function getCurrentDomainFromActiveTab() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs.length > 0 && tabs[0].url) {
                try {
                    const url = new URL(tabs[0].url);
                    // Use the full hostname as the key. It's simple and reliable.
                    if (url.protocol.startsWith('chrome')) {
                        resolve('chrome-internal');
                    } else if (url.protocol === 'file:') {
                        resolve('file-local');
                    } else {
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
 */
getCurrentDomainFromActiveTab().then(currentDomain => {
    chrome.storage.local.get(['selectors', 'isPersistenceEnabled'], result => {
        const allSelectors = result.selectors || {};
        const domainSelectors = allSelectors[currentDomain] || [];
        selectorsArea.value = domainSelectors.join('\n');
        persistCheckbox.checked = result.isPersistenceEnabled !== false;
    });
});

/**
 * Handles changes to the persistence checkbox.
 */
persistCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ isPersistenceEnabled: persistCheckbox.checked });
});

/**
 * Handles the "Clear All" button click for the current domain.
 */
clearAllButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete all selectors for this domain? This cannot be undone.')) {
        getCurrentDomainFromActiveTab().then(currentDomain => {
            chrome.storage.local.get(['selectors'], result => {
                const allSelectors = result.selectors || {};
                delete allSelectors[currentDomain];

                chrome.storage.local.set({ selectors: allSelectors }, () => {
                    selectorsArea.value = '';
                    console.log(`Selectors for ${currentDomain} have been cleared.`);

                    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                        if (tabs.length > 0 && tabs[0].id) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: 'updateSelectors',
                                selectors: allSelectors 
                            }, () => {
                                if (chrome.runtime.lastError) {
                                    console.warn("Element Hider: Could not send message to content script. It might not be injected on this page.");
                                }
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
 */
selectElement.addEventListener('change', event => {
    const selectedPreset = presets?.find(p => p.name === event.target.value);
    if (selectedPreset) {
      selectorsArea.value = selectedPreset.selectors.join('\n');
    }
});

/**
 * Handles the "Save and Apply" button click.
 */
saveButton.addEventListener('click', () => {
    const selectorsText = selectorsArea.value;
    const selectors = selectorsText.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    saveButton.textContent = 'Saving...';
    saveButton.classList.add('saving');
    saveButton.disabled = true;

    getCurrentDomainFromActiveTab().then(currentDomain => {
        chrome.storage.local.get(['selectors'], result => {
            const allSelectors = result.selectors || {};
            allSelectors[currentDomain] = selectors; 

            chrome.storage.local.set({ selectors: allSelectors }, () => {
                chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                    if (tabs.length > 0 && tabs[0].id) {
                        chrome.tabs.sendMessage(tabs[0].id, { action: 'updateSelectors', selectors: allSelectors }, () => {
                            if (chrome.runtime.lastError) {
                                console.warn("Element Hider: Could not send message to content script. Settings were saved but not applied in real-time.");
                            }
                            
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