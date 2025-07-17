// sevwren-element-hider/content.js (Corrected and Final Version)

// Function to update hidden elements by injecting or updating a style tag
function updateHiddenElements(selectors) {
    let style = document.getElementById('element-hider-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'element-hider-style';
      document.head.appendChild(style);
    }
  
    const cssRules = selectors.map(selector => `${selector} { display: none !important; }`).join('\n');
    style.textContent = cssRules;
}

// --- START: Picker Mode Logic ---

let isPickerModeActive = false;
let highlightElement = null;

// Handlers for cancelling the picker mode
function handleKeydownCancel(event) {
    if (event.key === "Escape") { console.log('Element Hider: Escape key pressed, cancelling picker mode.'); } 
    else { console.log(`Element Hider: Key pressed (${event.key}), cancelling picker mode.`); }
    deactivatePickerMode();
}

function handleMouseDownCancel(event) {
    if (event.button !== 0) {
        console.log('Element Hider: Non-left mouse button clicked, cancelling picker mode.');
        event.preventDefault();
        event.stopPropagation();
        deactivatePickerMode();
    }
}

function activatePickerMode() {
  if (isPickerModeActive) return;
  isPickerModeActive = true;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('mouseout', handleMouseOut);
  document.addEventListener('click', handleElementClick, { capture: true });
  document.addEventListener('keydown', handleKeydownCancel, { capture: true });
  document.addEventListener('mousedown', handleMouseDownCancel, { capture: true });
  console.log('Element Hider: Picker mode ACTIVATED. Left-click to select, or press any other key/button to cancel.');
}

function deactivatePickerMode() {
  if (!isPickerModeActive) return;
  isPickerModeActive = false;
  document.body.style.cursor = 'default';
  if (highlightElement) { highlightElement.style.outline = ''; }
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleElementClick, { capture: true });
  document.removeEventListener('keydown', handleKeydownCancel, { capture: true });
  document.removeEventListener('mousedown', handleMouseDownCancel, { capture: true });
  console.log('Element Hider: Picker mode DEACTIVATED.');
}

function handleMouseOver(event) {
  highlightElement = event.target;
  highlightElement.style.outline = '2px solid #e60000';
}

function handleMouseOut(event) {
  if (event.target) { event.target.style.outline = ''; }
}

function handleElementClick(event) {
  console.log('Element Hider: Left-click captured!');
  event.preventDefault();
  event.stopPropagation();

  const clickedElement = event.target;
  const selector = generateSelector(clickedElement);
  console.log('Element Hider: Generated Selector:', selector);

  chrome.storage.local.get({ selectors: [] }, (result) => {
    const existingSelectors = result.selectors || [];
    if (!existingSelectors.includes(selector)) {
        const newSelectors = [...existingSelectors, selector];
        // This saves the new list to storage.
        chrome.storage.local.set({ selectors: newSelectors }, () => {
          // --- THIS IS THE FIX ---
          // This callback runs AFTER the data is saved.
          // We MUST update the view from here to provide immediate feedback.
          updateHiddenElements(newSelectors);
          // --------------------
          console.log('Element Hider: Selector saved and applied.');
        });
    } else {
        console.log('Element Hider: Selector already exists.');
    }
  });

  deactivatePickerMode();
}

function generateSelector(el) {
  let path = [];
  let current = el;
  while (current.parentElement) {
    let segment = current.tagName.toLowerCase();
    if (current.id) { segment += `#${current.id}`; path.unshift(segment); break; }
    const stableClasses = Array.from(current.classList).filter(c => !c.includes('hover') && !c.includes('active'));
    if (stableClasses.length > 0) { segment += '.' + stableClasses.join('.'); }
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
// --- END: Picker Mode Logic ---

// --- START: Original Auto-Clicker Logic ---
function checkInitialElement(targetSelector, actionCallback) {
  document.querySelectorAll(targetSelector).forEach(actionCallback);
}
function clickTargetElement(targetElement) {
  targetElement.click();
}
// --- END: Original Auto-Clicker Logic ---

// --- MAIN EXECUTION LOGIC ---

// 1. Check for persistence setting and apply selectors on page load if enabled
chrome.storage.local.get(['selectors', 'isPersistenceEnabled'], function (result) {
  const shouldPersist = result.isPersistenceEnabled !== false;
  if (shouldPersist && result.selectors && result.selectors.length > 0) {
    console.log('Element Hider: Persistence is enabled. Applying saved selectors on page load.');
    updateHiddenElements(result.selectors);
  } else {
    console.log('Element Hider: Persistence is disabled or no selectors saved. Skipping application on page load.');
  }
});

// 2. Listen for messages from the background script or popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'updateSelectors') {
    updateHiddenElements(request.selectors);
    sendResponse({status: "Selectors updated"});
  } else if (request.action === 'togglePickerMode') {
    if (isPickerModeActive) {
      deactivatePickerMode();
    } else {
      activatePickerMode();
    }
    sendResponse({status: "Picker mode toggled"});
  }
  // The obsolete 'resetPage' listener has been removed.
  return true;
});

// 3. Start the original auto-clicker for '.btn.btn-skip'
checkInitialElement('.btn.btn-skip', clickTargetElement);