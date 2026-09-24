/**
 * Consent management logic
 * -------------------------
 * Handles:
 *  - Google Consent Mode v2 default and update signals
 *  - Conditional loading of Google Tag Manager
 *  - Storing the user's choice in localStorage
 *  - The consent banner and the "Manage Preferences" modal
 *  - The floating "Manage Cookies" icon
 *  - Cookie sweeping when consent is withdrawn
 *
 * IMPORTANT: this file must load as early as possible in <head>,
 * without the "defer" or "async" attribute, and before any other
 * script that might set cookies. See GTM-GA4-SETUP.md for details.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Configuration - update these two values for your site
  // ---------------------------------------------------------------------
  var GTM_CONTAINER_ID = 'GTM-XXXXXXX'; // replace with your GTM container ID
  var CONSENT_VERSION = '2.0';
  var STORAGE_KEY = 'cookie_consent';

  // Cookie name patterns swept when a category is denied or withdrawn.
  // Extend these lists if you add further analytics/advertising tools.
  var ANALYTICS_COOKIE_PATTERNS = [/^_ga/, /^_gid$/, /^_gat/, /^_dc_gtm_/];
  var ADVERTISING_COOKIE_PATTERNS = [
    /^_gcl_/, /^_gac_/, /^IDE$/, /^test_cookie$/,
    /^_fbp$/, /^_fbc$/, /^fr$/, /^ads\//
  ];

  // ---------------------------------------------------------------------
  // dataLayer / gtag helpers
  // ---------------------------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }

  function pushDefaultConsent() {
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted',
      wait_for_update: 500
    });
  }

  function pushConsentUpdate(state) {
    gtag('consent', 'update', {
      ad_storage: state.ad_storage,
      ad_user_data: state.ad_user_data,
      ad_personalization: state.ad_personalization,
      analytics_storage: state.analytics_storage
    });
    window.dataLayer.push({ event: 'consent_update' });
  }

  // Run the default consent push immediately, before anything else,
  // so that even if GTM later reads the dataLayer, it sees "denied" first.
  pushDefaultConsent();

  // ---------------------------------------------------------------------
  // GTM loading
  // ---------------------------------------------------------------------
  var gtmLoaded = false;

  function loadGTM() {
    if (gtmLoaded) return;
    gtmLoaded = true;

    (function (w, d, s, l, i) {
      w[l] = w[l] || [];
      w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      var f = d.getElementsByTagName(s)[0];
      var j = d.createElement(s);
      var dl = l !== 'dataLayer' ? '&l=' + l : '';
      j.async = true;
      j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
      f.parentNode.insertBefore(j, f);
    })(window, document, 'script', 'dataLayer', GTM_CONTAINER_ID);

    // Optional noscript fallback for users without JavaScript.
    // Only relevant once consent has actually been granted, so it is
    // added here rather than hard-coded in the page markup.
    var noscript = document.createElement('noscript');
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.googletagmanager.com/ns.html?id=' + GTM_CONTAINER_ID;
    iframe.height = '0';
    iframe.width = '0';
    iframe.style.display = 'none';
    iframe.style.visibility = 'hidden';
    noscript.appendChild(iframe);
    document.body.appendChild(noscript);
  }

  // ---------------------------------------------------------------------
  // Cookie sweeping
  // ---------------------------------------------------------------------
  function deleteCookie(name) {
    var host = window.location.hostname;
    var paths = ['/'];
    var domains = ['', '; domain=' + host, '; domain=.' + host];
    paths.forEach(function (path) {
      domains.forEach(function (domain) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=' + path + domain;
      });
    });
  }

  function sweepCookies(patterns) {
    var existing = document.cookie.split(';');
    existing.forEach(function (entry) {
      var name = entry.split('=')[0].trim();
      if (!name) return;
      patterns.forEach(function (pattern) {
        if (pattern.test(name)) {
          deleteCookie(name);
        }
      });
    });
  }

  // ---------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------
  function getStoredConsent() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed.version !== CONSENT_VERSION) return null; // force re-consent on policy changes
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function saveConsent(analyticsGranted, advertisingGranted) {
    var record = {
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
      analytics_storage: analyticsGranted ? 'granted' : 'denied',
      ad_storage: advertisingGranted ? 'granted' : 'denied',
      ad_user_data: advertisingGranted ? 'granted' : 'denied',
      ad_personalization: advertisingGranted ? 'granted' : 'denied'
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) {
      // localStorage may be unavailable (private browsing, quota, etc.)
      // Consent still applies for this page view via pushConsentUpdate.
    }
    return record;
  }

  function applyConsent(record, isInitialLoad) {
    pushConsentUpdate(record);

    var anyGranted = record.analytics_storage === 'granted' || record.ad_storage === 'granted';
    if (anyGranted) {
      loadGTM();
    }

    if (record.analytics_storage !== 'granted') {
      sweepCookies(ANALYTICS_COOKIE_PATTERNS);
    }
    if (record.ad_storage !== 'granted') {
      sweepCookies(ADVERTISING_COOKIE_PATTERNS);
    }
  }

  // ---------------------------------------------------------------------
  // UI wiring (runs once the DOM is ready)
  // ---------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    var banner = document.getElementById('consent-banner');
    var bannerCloseBtn = document.getElementById('consent-banner-close');
    var rejectAllBtn = document.getElementById('consent-reject-all');
    var manageBtn = document.getElementById('consent-manage');
    var acceptAllBtn = document.getElementById('consent-accept-all');

    var overlay = document.getElementById('consent-modal-overlay');
    var modal = document.getElementById('consent-modal');
    var modalCloseBtn = document.getElementById('consent-modal-close');
    var analyticsCheckbox = document.getElementById('consent-analytics-checkbox');
    var advertisingCheckbox = document.getElementById('consent-advertising-checkbox');
    var modalRejectAllBtn = document.getElementById('consent-modal-reject-all');
    var savePreferencesBtn = document.getElementById('consent-save-preferences');

    var floatingIcon = document.getElementById('consent-floating-icon');

    var lastFocusedElement = null;

    // --- Banner visibility -------------------------------------------
    function showBanner() {
      banner.hidden = false;
      document.addEventListener('keydown', onBannerKeydown);
      rejectAllBtn.focus();
    }

    function hideBanner() {
      banner.hidden = true;
      document.removeEventListener('keydown', onBannerKeydown);
    }

    function onBannerKeydown(e) {
      if (e.key === 'Escape') {
        // Dismissing without a choice cannot count as consent, so this
        // is treated the same as Reject All.
        handleRejectAll();
      }
    }

    // --- Modal visibility ----------------------------------------------
    function openModal() {
      lastFocusedElement = document.activeElement;
      var stored = getStoredConsent();
      analyticsCheckbox.checked = !!stored && stored.analytics_storage === 'granted';
      advertisingCheckbox.checked = !!stored && stored.ad_storage === 'granted';

      overlay.hidden = false;
      modal.hidden = false;
      document.addEventListener('keydown', onModalKeydown);
      modalCloseBtn.focus();
    }

    function closeModal() {
      overlay.hidden = true;
      modal.hidden = true;
      document.removeEventListener('keydown', onModalKeydown);
      if (lastFocusedElement) lastFocusedElement.focus();
    }

    function onModalKeydown(e) {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key === 'Tab') {
        trapFocus(e, modal);
      }
    }

    function trapFocus(e, container) {
      var focusable = container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // --- Actions ---------------------------------------------------------
    function handleRejectAll() {
      var record = saveConsent(false, false);
      applyConsent(record, false);
      hideBanner();
      closeModal();
    }

    function handleAcceptAll() {
      var record = saveConsent(true, true);
      applyConsent(record, false);
      hideBanner();
      closeModal();
    }

    function handleSavePreferences() {
      var record = saveConsent(analyticsCheckbox.checked, advertisingCheckbox.checked);
      applyConsent(record, false);
      hideBanner();
      closeModal();
    }

    rejectAllBtn.addEventListener('click', handleRejectAll);
    acceptAllBtn.addEventListener('click', handleAcceptAll);
    manageBtn.addEventListener('click', openModal);
    if (bannerCloseBtn) bannerCloseBtn.addEventListener('click', handleRejectAll);

    modalCloseBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
    modalRejectAllBtn.addEventListener('click', handleRejectAll);
    savePreferencesBtn.addEventListener('click', handleSavePreferences);

    floatingIcon.addEventListener('click', openModal);

    // --- Initial state on page load --------------------------------------
    var stored = getStoredConsent();
    if (stored) {
      applyConsent(stored, true);
    } else {
      showBanner();
    }
  });
})();