// sevwren-element-hider/popup.js (Complete File with All Modifications)

document.addEventListener('DOMContentLoaded', () => {
    let presets = null;
    const selectorsArea = document.getElementById('selectors');
    const selectElement = document.getElementById('preset-select');
    const saveButton = document.getElementById('save');
    const persistCheckbox = document.getElementById('persist-checkbox');
    // Get the new "Clear All" button
    const clearAllButton = document.getElementById('clear-all');

    // Load presets from the JSON file
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

    // Load saved user data (selectors and persistence setting) when the popup opens
    chrome.storage.local.get(['selectors', 'isPersistenceEnabled'], result => {
        if (result.selectors) {
          selectorsArea.value = result.selectors.join('\n');
        }
        // Default to 'true' (checked) if the setting has never been saved
        persistCheckbox.checked = result.isPersistenceEnabled !== false;
    });

    // Add listener for the persistence checkbox
    persistCheckbox.addEventListener('change', () => {
        // Save the new state whenever it's toggled
        chrome.storage.local.set({ isPersistenceEnabled: persistCheckbox.checked });
    });

    // Add listener for the "Clear All" button
    clearAllButton.addEventListener('click', () => {
        // Use a confirmation dialog to prevent accidental deletion of all data
        if (confirm('Are you sure you want to permanently delete all saved selectors? This cannot be undone.')) {
            
            // 1. Clear the selectors array in Chrome's storage
            chrome.storage.local.set({ selectors: [] }, () => {
                
                // 2. Clear the textarea in the popup UI to reflect the change
                selectorsArea.value = '';
                console.log('All saved selectors have been deleted.');

                // 3. Send a message to the content script on the active page to clear its styles
                chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                    if (tabs.length > 0) {
                        // Re-using the 'updateSelectors' action with an empty array effectively resets the page
                        chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'updateSelectors',
                            selectors: [] // An empty array tells content.js to hide nothing
                        });
                    }
                });
            });
        }
    });

    // Add listener for the preset dropdown
    selectElement.addEventListener('change', event => {
        const selectedPreset = presets?.find(p => p.name === event.target.value);
        if (selectedPreset) {
          selectorsArea.value = selectedPreset.selectors.join('\n');
        }
    });

    // Add listener for the "Save and Apply" button
    saveButton.addEventListener('click', () => {
        const selectorsText = selectorsArea.value;
        const selectors = selectorsText.split('\n').map(s => s.trim()).filter(s => s.length > 0);

        // UI feedback for saving
        saveButton.textContent = 'Saving...';
        saveButton.classList.add('saving');
        saveButton.disabled = true;

        // Save the new selectors list to storage
        chrome.storage.local.set({ selectors: selectors }, () => {
          // Notify the active tab to apply the new rules immediately
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs.length > 0) {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'updateSelectors', selectors: selectors }, () => {
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