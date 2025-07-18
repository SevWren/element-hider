# 🌟 Element Hider: TM's Masterpiece

Element Hider is a lightweight, user-friendly Chrome extension that allows you to **hide unwanted elements** on web pages using customizable CSS selectors and presets. Whether you're tired of ads, distractions, or just want a cleaner browsing experience, this extension has you covered! 🎯

📝 **Created for my memoir in Middle School, California** – This project is inspired by my coding journey back in the day when I was just starting out. Element Hider is a tribute to the creative spark that lit my path into tech. 🌈

## 🎉 Features

- **Custom CSS Selectors**: Enter your own CSS selectors to hide specific elements.
- **One-Click Element Hiding**: Press `Ctrl+Shift+E` (Windows/Linux) or `Cmd+Shift+X` (Mac) to activate the element picker and click on any element to hide it.
- **Undo Last Hiding Action**: Quickly revert the last element hidden with the picker tool using `Ctrl+Shift+Z` (Windows/Linux) or `Cmd+Shift+Z` (Mac).
- **Advanced Element Picker**: While in picker mode, use the mouse wheel to scroll up/down and select parent/child elements for precise hiding.
- **Dynamic Content Support**: Automatically re-applies hiding rules on dynamically loaded content and Single Page Applications (SPAs).
- **Persistence Controls**: Choose whether hidden elements stay hidden after page reloads.
- **Quick Reset**: One-click removal of all hidden elements.
- **Preset Management**: Choose from predefined sets of selectors for common annoyances like ads, pop-ups, or social media distractions.
- **Real-Time Updates**: Changes are applied immediately to the current tab.
- **Clean Interface**: Minimalistic popup design with easy-to-use options.

## 🚀 How It Works

1. **Define Selectors**: Add CSS selectors for elements you want to hide (e.g., .ads, #popups).
2. **Choose a Preset**: Use prebuilt presets for common annoyances or create your own.
3. **Save and Apply**: Click the Save and Apply button, and watch unwanted elements disappear!
4. **Zap Elements**:
   - Use the hotkey `Ctrl+Shift+E` and click any element to hide it. (Customizable in
     Chrome settings at `chrome://extensions/shortcuts`)
   - **Advanced Picker**: Once activated, use your mouse wheel to navigate up/down the DOM tree and select parent or child elements precisely.
5. **Manage Elements**:
   - Toggle persistence to keep elements hidden across page reloads.
   - Click "Clear All" to reset the page to its original state.
   - Use presets for common annoyances or create your own.
   - **Undo Last Hiding**: Press `Ctrl+Shift+Z` (Windows/Linux) or `Cmd+Shift+Z` (Mac) to quickly revert the last hidden element.

## 🛠️ How to Install Locally

To test or use this extension before it's available on the Chrome Web Store:

### 1. **Clone the Repository**

```bash
git clone https://github.com/tmsoontornsing/element-hider.git
cd element-hider
```

### 2. **Load Extension in Chrome**

1. Open Chrome and go to chrome://extensions/
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the folder where you cloned the repository

### 3. **Start Using It**

\*\*Click the extension icon in the Chrome toolbar

- Add your CSS selectors or choose a preset and click Save and Apply

## 📦 Project Files

- **popup.html**: The UI for the extension popup
- **popup.js**: Handles the popup's interactivity
- **content.js**: Injects CSS rules to hide elements on web pages
- **preset.json**: Stores prebuilt presets for common use cases
- **styles.css**: Makes the popup look clean and modern
- **manifest.json**: The heart of the extension, describing its functionality

~~## 🌟 Coming Soon: Chrome Web Store~~

~~This extension will soon be available on the **Chrome Web Store** for easy installation. Once published, the link will be updated here! Stay tuned. 🛒
<https://bit.ly/elementhider>~~

## 🌟 Available on the Chrome Web Store

The **Element Hider: TM's Masterpiece** extension is now live and ready for installation! 🎉  
[Install it from the Chrome Web Store](https://bit.ly/elementhider) and enjoy a cleaner, distraction-free browsing experience.

## 🛡️ License

This project is licensed under the MIT License. Feel free to use, modify, and share it with proper attribution. 💖

## 💌 Acknowledgments

- **California Middle School Days**: For sparking the joy of coding
- **Chrome Developers**: For providing a robust platform for browser extensions
- **You**: For being interested in this project! 🙌

## 🌟 Connect with Me

If you have questions, feedback, or just want to connect, feel free to reach out:

- **Website**: codeontheway.com/tm
- **GitHub**: tmsoontornsing
- **Email**: <tmsoontornsing@gmail.com>

🎉 **Enjoy a cleaner, distraction-free browsing experience with Element Hider!**

## 🤝 Contributors

- **Sevwren**: [http://github.com/sevWren](http://github.com/sevWren)

Let me know if you'd like any other changes or additions! 😊
