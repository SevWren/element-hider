# Element Hider: Edge Cases and Improvements

This document outlines potential edge cases, improvements, and technical debt items for the Element Hider Chrome extension. It's organized by priority and category for easy reference.

## Table of Contents
1. [Critical Edge Cases](#critical-edge-cases)
2. [Performance Considerations](#performance-considerations)
3. [User Experience Improvements](#user-experience-improvements)
4. [Technical Debt](#technical-debt)
5. [Feature Enhancements](#feature-enhancements)
6. [Security Considerations](#security-considerations)
7. [Testing Strategy](#testing-strategy)

## Critical Edge Cases

### Content Script Loading
- [ ] **Race Condition on Page Load**
  - **Issue**: Content script might load after initial DOM is ready but before all dynamic content loads.
  - **Impact**: Elements loaded dynamically might be missed.
  - **Solution**: Implement a more robust initialization strategy that checks for dynamic content loading.

- [ ] **Chrome Web Store Pages**
  - **Issue**: Content scripts don't run on `chrome://` URLs by default.
  - **Impact**: Extension won't work on Chrome Web Store pages.
  - **Solution**: Handle this gracefully with a user-friendly message.

### Selector Stability
- [ ] **Dynamic Class Names**
  - **Issue**: Modern frameworks (React, Vue, etc.) generate dynamic class names.
  - **Impact**: Selectors based on these classes become invalid after page reload.
  - **Solution**: Prioritize more stable attributes like `data-testid` or `id` in selector generation.

- [ ] **Z-Index Conflicts**
  - **Issue**: Elements with high z-index might still be visible.
  - **Impact**: Some elements might not be properly hidden.
  - **Solution**: Add `!important` to z-index and other positioning properties.

## Performance Considerations

### Mutation Observer
- [ ] **Debounce Mutation Events**
  - **Issue**: Frequent DOM mutations can cause performance issues.
  - **Impact**: Slows down page performance on dynamic sites.
  - **Solution**: Implement a more aggressive debounce strategy.

### Memory Management
- [ ] **Memory Leaks**
  - **Issue**: Event listeners and observers might not be properly cleaned up.
  - **Impact**: Memory leaks over time.
  - **Solution**: Implement proper cleanup in `window.unload`.

## User Experience Improvements

### Visual Feedback
- [ ] **Visual Indicator for Hidden Elements**
  - **Issue**: No visual indication of which elements are hidden.
  - **Impact**: Users might be confused about what's happening.
  - **Solution**: Add a subtle border or outline to hidden elements in developer mode.

### Error Handling
- [ ] **Better Error Messages**
  - **Issue**: Generic error messages in console.
  - **Impact**: Difficult to debug issues.
  - **Solution**: Add more descriptive error messages with error codes.

## Technical Debt

### Code Organization
- [ ] **Modularize Code**
  - **Issue**: Content script is getting large.
  - **Impact**: Hard to maintain.
  - **Solution**: Split into separate modules (e.g., `picker.js`, `storage.js`).

### Type Safety
- [ ] **Add TypeScript**
  - **Issue**: JavaScript lacks type safety.
  - **Impact**: Potential runtime errors.
  - **Solution**: Migrate to TypeScript.

## Feature Enhancements

### Selector Management
- [ ] **Selector Groups**
  - **Issue**: All selectors are in a single list.
  - **Impact**: Hard to manage many selectors.
  - **Solution**: Allow grouping selectors into named collections.

### Import/Export
- [ ] **Export/Import Settings**
  - **Issue**: No way to backup or share settings.
  - **Impact**: Users lose settings when reinstalling.
  - **Solution**: Add export/import functionality.

## Security Considerations

### Content Security Policy (CSP)
- [ ] **CSP Bypass**
  - **Issue**: Some sites have strict CSP that might block style injection.
  - **Impact**: Extension might not work on some sites.
  - **Solution**: Handle CSP errors gracefully / Potential workarounds

### Permissions
- [ ] **Minimal Permissions**
  - **Issue**: Extension requests broad permissions.
  - **Impact**: Privacy concerns.
  - **Solution**: Review and minimize permissions.

## Testing Strategy

### Unit Tests
- [ ] **Establish a Testing Foundation and Augment with AI**
  - **Issue**: No test coverage for core logic, making refactoring risky and manual verification time-consuming.
  - **Impact**: High risk of regressions with any new feature or bug fix. It's difficult to verify that complex functions like `generateSelector` work correctly across all edge cases.
  - **Solution**:
    - **1. Establish Baseline Coverage**: Implement a testing framework like Jest. Write initial manual unit tests for critical, pure functions (e.g., `generateSelector` in `content.js`, preset management in `popup.js`).
    - **2. Set up Coverage Reporting**: Configure the test runner to generate code coverage reports (e.g., using Jest's `--coverage` flag and the Cobertura XML format). This is a prerequisite for AI-driven improvement tools.
    - **3. Evaluate AI Test Generation**: Following the principles of Meta's TestGen-LLM, investigate using an open-source tool like CodiumAI's **Cover-Agent**. The goal is to automatically generate new tests that target uncovered lines and edge cases in the codebase.
    - **4. Integrate into Workflow**: Create a workflow where developers can run the AI agent to augment existing tests. The agent's "Assured LLMSE" approach (filtering for tests that compile, pass, and increase coverage) would prevent regressions while systematically improving test quality and coverage toward a defined goal (e.g., 85%).

### E2E Tests
- [ ] **Automate End-to-End User Journeys with AI Assistance**
  - **Issue**: No automated end-to-end tests to simulate real user interactions.
  - **Impact**: Manual testing is required for every release, which is slow, error-prone, and cannot cover all scenarios (e.g., testing on various complex websites).
  - **Solution**:
    - **1. Set up E2E Framework**: Implement an E2E testing framework using a modern tool like **Puppeteer** or **Playwright** with Jest. The setup must handle loading the unpacked extension into a controlled browser instance for testing.
    - **2. Define Core User Scenarios**: Script out critical user paths for automated testing:
        - Opening the popup, adding a selector, clicking "Save and Apply," and verifying the target element on a test page is hidden.
        - Triggering the element picker hotkey (`Cmd+Shift+X`/`Ctrl+Shift+E`), clicking an element, and verifying it's added to storage and hidden.
        - Using the "Revert Last Action" hotkey and verifying the element reappears.
        - Applying a preset from the dropdown and verifying multiple elements are hidden.
        - Clicking "Clear All" and verifying all custom styles are removed from the page.
    - **3. Explore AI-Assisted Scripting**: While Cover-Agent focuses on unit tests, apply the same principle to E2E. Investigate using LLMs (e.g., via OpenAI API, GitHub Copilot) to generate boilerplate Puppeteer/Playwright code for new test scenarios based on plain-text descriptions of user actions. This can significantly speed up the creation of new E2E tests.

## Implementation Notes

### Performance Profiling
- [ ] **Profile Performance**
  - **Issue**: No performance metrics.
  - **Impact**: Don't know where optimizations are needed.
  - **Solution**: Add performance profiling.

### Browser Compatibility
- [ ] **Test on Multiple Browsers**
  - **Issue**: Only tested on Chrome.
  - **Impact**: Might not work on other browsers.
  - **ToRead**: Other github extension projects with automated build scripts for compiling multiple browser versions and backward engingeering the differences across multiple sets of build scripts to generate a somewhat detailed list of main concerns when ensuring compatibility across multiple browsers other then the Chromium Embedded Framework.
  - **Solution**: Test on Firefox and Edge.

## Conclusion

This document serves as a living document for tracking improvements and edge cases. Prioritize items based on user feedback and bug reports.
