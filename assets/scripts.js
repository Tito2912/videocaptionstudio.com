/* ==========================================================================
   VideoCaptionStudio — main.js
   - Accessible nav (burger)
   - Language suggestion (non-blocking)
   - Consent Mode v2 + GA4 (opt-in, 13 months)
   - UTM capture (90 days) + propagation to affiliate CTAs
   - Affiliate click tracking (GA4 event)
   - YouTube Lite: IO + iframe on click + video_start / video_complete
   - Misc: current year
   ========================================================================== */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ------------------------------------------------------
   * 0) Year stamp in footer
   * ------------------------------------------------------ */
  function setYear() {
    const el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ------------------------------------------------------
   * 1) Accessible burger navigation
   * ------------------------------------------------------ */
  function initNav() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      const burger = toggle.querySelector('.burger');
      if (burger) burger.style.transform = isOpen ? 'rotate(90deg)' : 'none';
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        const burger = toggle.querySelector('.burger');
        if (burger) burger.style.transform = 'none';
      }
    });
  }

  /* ------------------------------------------------------
   * 2) Language suggestion (non-blocking banner)
   * ------------------------------------------------------ */
  function initLangSuggest() {
    try {
      const banner = $('#lang-suggest');
      if (!banner) return;
      const pageLang = (document.documentElement.lang || 'en').toLowerCase();
      const pref = (navigator.language || 'en').toLowerCase();
      const isFrenchPref = pref.startsWith('fr');
      const isPageFrench = pageLang.startsWith('fr');
      const dismissed = sessionStorage.getItem('vcs_lang_suggest_dismissed') === '1';

      if (!dismissed && isFrenchPref !== isPageFrench) {
        banner.hidden = false;
      }

      const closeBtn = banner.querySelector('[data-close-lang-suggest]');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          banner.hidden = true;
          sessionStorage.setItem('vcs_lang_suggest_dismissed', '1');
        });
      }
    } catch (_) {}
  }

  /* ------------------------------------------------------
   * 3) Consent Mode v2 + cookie banner (GA4 after consent)
   * ------------------------------------------------------ */
  const CONSENT_KEY = 'vcs_consent_v1';

  // DataLayer stub + default denied (Consent Mode v2)
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  function getConsent() {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      // 13 months ≈ 13 * 30 days (approx). CNIL allows 13 months max.
      const exp = obj.ts + 13*30*24*60*60*1000;
      if (Date.now() > exp) {
        localStorage.removeItem(CONSENT_KEY);
        return null;
      }
      return obj;
    } catch { return null; }
  }

  function saveConsent(status) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ status, ts: Date.now() })); }
    catch {}
  }

  function injectGA4() {
    if (window.__ga4_injected) return;
    const tpl = document.getElementById('ga4-template');
    if (!tpl) return;
    window.__ga4_injected = true;

    // Execute any scripts inside the template
    const frag = document.createElement('div');
    frag.innerHTML = tpl.innerHTML;

    Array.from(frag.querySelectorAll('script')).forEach(s => {
      const sc = document.createElement('script');
      if (s.src) { sc.async = true; sc.src = s.src; }
      else { sc.textContent = s.textContent; }
      document.head.appendChild(sc);
    });
  }

  function updateConsentUI() {
    const banner = $('#cookie-banner');
    if (!banner) return;

    const stored = getConsent();
    const acceptBtn = banner.querySelector('[data-consent="accept"]');
    const denyBtn = banner.querySelector('[data-consent="deny"]');

    if (stored && stored.status) {
      banner.hidden = true;
      if (stored.status === 'accept') {
        gtag('consent', 'update', { analytics_storage: 'granted' });
        injectGA4();
      } else {
        gtag('consent', 'update', { analytics_storage: 'denied' });
      }
    } else {
      banner.hidden = false;
    }

    if (acceptBtn) acceptBtn.addEventListener('click', () => {
      saveConsent('accept');
      gtag('consent', 'update', { analytics_storage: 'granted' });
      injectGA4();
      banner.hidden = true;
    });

    if (denyBtn) denyBtn.addEventListener('click', () => {
      saveConsent('deny');
      gtag('consent', 'update', { analytics_storage: 'denied' });
      banner.hidden = true;
    });

    // "Manage cookies" buttons anywhere
    $$('[data-open-cookie]').forEach(btn => {
      btn.addEventListener('click', () => {
        banner.hidden = false;
      });
    });
  }

  /* ------------------------------------------------------
   * 4) UTM capture (90 days) + propagation to affiliate CTAs
   * ------------------------------------------------------ */
  const UTM_KEY = 'vcs_utm_v1';
  const UTM_PARAMS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];

  function captureUTM() {
    try {
      const url = new URL(window.location.href);
      const utm = {};
      let found = false;
      UTM_PARAMS.forEach(k => {
        const v = url.searchParams.get(k);
        if (v) { utm[k] = v; found = true; }
      });
      if (found) {
        localStorage.setItem(UTM_KEY, JSON.stringify({ utm, ts: Date.now() }));
      }
    } catch {}
  }

  function getUTM() {
    try {
      const raw = localStorage.getItem(UTM_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const exp = obj.ts + 90*24*60*60*1000; // 90 days
      if (Date.now() > exp) {
        localStorage.removeItem(UTM_KEY);
        return null;
      }
      return obj.utm || null;
    } catch { return null; }
  }

  function propagateUTM() {
    const utm = getUTM();
    if (!utm) return;
    const params = new URLSearchParams(utm);
    $$('.cta-aff').forEach(a => {
      try {
        const u = new URL(a.href, location.origin);
        UTM_PARAMS.forEach(k => { if (utm[k]) u.searchParams.set(k, utm[k]); });
        a.href = u.toString();
      } catch {}
    });
  }

  /* ------------------------------------------------------
   * 5) Affiliate click tracking (GA4)
   * ------------------------------------------------------ */
  function initAffiliateTracking() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      const isAffiliate = a.matches('.cta-aff') || (
        a.href && (
          a.href.includes('capcutaffiliateprogram.pxf.io/yq111D') ||
          a.href.includes('/go/capcut') ||
          a.href.includes('/fr/go/capcut')
        )
      );
      if (!isAffiliate) return;
      try {
        gtag('event', 'affiliate_click', {
          event_category: 'engagement',
          outbound_url: a.href
        });
      } catch {}
    });
  }

  /* ------------------------------------------------------
   * 6) YouTube Lite: IO + iframe on click + GA4 video events
   *     - loads Iframe API ONLY on interaction
   * ------------------------------------------------------ */
  function initYouTubeLite() {
    const players = new Map();
    let ytApiRequested = false;
    let ytApiReady = false;
    let ytReadyQueue = [];

    function whenYouTubeReady(cb) {
      if (ytApiReady) cb();
      else ytReadyQueue.push(cb);
    }

    // Expose required callback
    window.onYouTubeIframeAPIReady = function () {
      ytApiReady = true;
      ytReadyQueue.forEach(fn => { try { fn(); } catch {} });
      ytReadyQueue = [];
    };

    function requestYTApi() {
      if (ytApiRequested) return;
      ytApiRequested = true;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    }

    const io = ('IntersectionObserver' in window)
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              // Reserve for potential preconnect or high-res thumb logic
              io.unobserve(entry.target);
            }
          }
        }, { rootMargin: '200px' })
      : null;

    $$('.yt-lite').forEach((wrap) => {
      const vid = wrap.getAttribute('data-video-id');
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('tabindex', '0');

      const play = () => {
        if (wrap.classList.contains('is-playing')) return;
        wrap.classList.add('is-playing');

        const iframe = document.createElement('iframe');
        const params = new URLSearchParams({
          autoplay: '1',
          playsinline: '1',
          rel: '0',
          enablejsapi: '1',
          modestbranding: '1'
        });
        iframe.src = `https://www.youtube-nocookie.com/embed/${vid}?${params.toString()}`;
        iframe.title = 'YouTube video player';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.width = '560';
        iframe.height = '315';
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        iframe.style.width = '100%';
        iframe.style.height = '100%';

        // Replace placeholder
        wrap.innerHTML = '';
        wrap.appendChild(iframe);

        // Track start immediately
        try { gtag('event', 'video_start', { video_platform: 'youtube', video_id: vid }); } catch {}

        // Load API for completion tracking
        requestYTApi();
        whenYouTubeReady(() => {
          try {
            const YTPlayer = new YT.Player(iframe, {
              events: {
                'onStateChange': (ev) => {
                  if (ev.data === YT.PlayerState.ENDED) {
                    try { gtag('event', 'video_complete', { video_platform: 'youtube', video_id: vid }); } catch {}
                  }
                }
              }
            });
            players.set(vid, YTPlayer);
          } catch {}
        });
      };

      wrap.addEventListener('click', play);
      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
      });

      if (io) io.observe(wrap);
    });
  }

  /* ------------------------------------------------------
   * Init on DOM ready
   * ------------------------------------------------------ */
  function onReady() {
    setYear();
    initNav();
    initLangSuggest();
    updateConsentUI();
    propagateUTM();
    initAffiliateTracking();
    initYouTubeLite();
  }

  // Capture UTM as early as possible
  captureUTM();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
