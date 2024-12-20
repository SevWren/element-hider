// Function to update hidden elements based on selectors
function updateHiddenElements(selectors) {
    let style = document.getElementById('element-hider-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'element-hider-style';
      document.head.appendChild(style);
    }
  
    const cssRules = selectors.map(selector => `${selector} { display: none !important; }`).join('\n');
    style.textContent = cssRules;
    console.log('Applied CSS rules to hide elements:', cssRules);
  }
  
  // Function to recursively check added nodes and their descendants for a match
  function checkNodeAndDescendants(node, targetSelector, actionCallback) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // Check the current node
      if (node.matches(targetSelector)) {
        console.log(`Target element found with selector: ${targetSelector}`);
        actionCallback(node);
        return;
      }
  
      // Check the descendants
      node.querySelectorAll(targetSelector).forEach(descendant => {
        console.log(`Target descendant found with selector: ${targetSelector}`);
        actionCallback(descendant);
      });
    }
  }
  
  // Function to monitor DOM mutations and perform an action when a target is found
  function monitorMutations(targetSelector, actionCallback) {
    const observer = new MutationObserver((mutationsList) => {
      console.log('MutationObserver triggered.');
      mutationsList.forEach((mutation) => {
        console.log('Mutation type:', mutation.type);
        if (mutation.type === 'childList') {
          console.log('Added nodes:', mutation.addedNodes);
          mutation.addedNodes.forEach(node => {
            checkNodeAndDescendants(node, targetSelector, actionCallback);
          });
        }
      });
    });
  
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('Started observing DOM mutations for target:', targetSelector);
  
    return observer; // Return observer in case you need to disconnect it
  }
  
  // Action to perform when the target element is found
  function clickTargetElement(targetElement) {
    targetElement.click(); // Simulate a click on the element
    console.log("Clicked on target element:", targetElement);
  }
  
  // Initial check for the target element in the DOM
  function checkInitialElement(targetSelector, actionCallback) {
    document.querySelectorAll(targetSelector).forEach(element => {
      console.log(`Initial target element found with selector: ${targetSelector}`);
      actionCallback(element);
    });
  }
  
  // Load saved selectors and apply them to hide elements
  chrome.storage.local.get(['selectors'], function (result) {
    if (result.selectors) {
      console.log('Applying selectors:', result.selectors);
      updateHiddenElements(result.selectors);
    }
  });
  
  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === 'updateSelectors') {
      console.log('Updating selectors:', request.selectors);
      updateHiddenElements(request.selectors);
    }
  });
  
  // Check for the target element initially and start monitoring
  checkInitialElement('.btn.btn-skip', clickTargetElement);
  monitorMutations('.btn.btn-skip', clickTargetElement);