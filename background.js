// sevwren-element-hider/background.js (Improved)
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-picker-mode") {
    // Get the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Send a message and include a callback to handle potential errors
        chrome.tabs.sendMessage(tabs[0].id, { action: "togglePickerMode" }, (response) => {
          if (chrome.runtime.lastError) {
            // This will catch the error gracefully instead of it being "Uncaught"
            console.warn("Element Hider: Could not connect to the content script. Please reload the page and try again.");
          } else {
            console.log("Response from content script:", response);
          }
        });
      }
    });
  }
});