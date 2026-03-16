// theme.js - applies and persists theme across all pages
(function () {
  const STORAGE_KEY = 'service-scroller-theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  // Apply immediately on script load to prevent flash
  applyTheme(getTheme());

  window.ThemeManager = { applyTheme, getTheme };
})();
