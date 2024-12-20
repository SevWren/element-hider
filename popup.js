document.addEventListener('DOMContentLoaded', () => {
    let presets = null;
  
    // Load presets from JSON file
    fetch('preset.json')
      .then(response => response.json())
      .then(data => {
        presets = data.presets;
        const selectElement = document.getElementById('preset-select');
  
        // Populate dropdown with presets
        if (selectElement) {
          presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name;
            selectElement.appendChild(option);
          });
        }
      })
      .catch(error => console.error('Error loading presets:', error));
  
    // Load saved selectors
    const selectorsArea = document.getElementById('selectors');
    if (selectorsArea) {
      chrome.storage.local.get(['selectors'], result => {
        if (result.selectors) {
          selectorsArea.value = result.selectors.join('\n');
        }
      });
    }
  
    // Handle preset selection
    const selectElement = document.getElementById('preset-select');
    if (selectElement) {
      selectElement.addEventListener('change', event => {
        const selectedPreset = presets?.find(p => p.name === event.target.value);
        if (selectedPreset) {
          selectorsArea.value = selectedPreset.selectors.join('\n');
        }
      });
    }
  
    // Save selectors with UI feedback
    const saveButton = document.getElementById('save');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        // Get selectors
        const selectorsText = selectorsArea.value;
        const selectors = selectorsText
          .split('\n')
          .map(s => s.trim())
          .filter(s => s.length > 0);
  
        // Show saving state
        saveButton.textContent = 'Saving...';
        saveButton.classList.add('saving');
        saveButton.disabled = true;
  
        // Save to storage
        chrome.storage.local.set({ selectors: selectors }, () => {
          console.log('Selectors saved:', selectors);
  
          // Notify content script
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs.length > 0) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'updateSelectors',
                selectors: selectors
              }, () => {
                // Handle success
                saveButton.classList.remove('saving');
                saveButton.classList.add('success');
                saveButton.textContent = 'Saved!';
                setTimeout(() => {
                  saveButton.textContent = 'Save and Apply';
                  saveButton.classList.remove('success');
                  saveButton.disabled = false;
                }, 1500);
              });
            } else {
              console.warn('No active tabs found.');
            }
          });
        });
      });
    }
  });