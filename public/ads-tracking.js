/* Google Ads partner-click tracking. A click is a referral, not an affiliate sale. */
(function () {
  'use strict';
  if (window.__ptrAdsTracking) return;
  window.__ptrAdsTracking = true;

  // Most pages already load the Ads tag; research pages may only have GA4.
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
  }
  if (!document.querySelector('script[src*="gtag/js?id=AW-18545848708"]')) {
    window.gtag('config', 'AW-18545848708');
    if (!document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
      var tag = document.createElement('script');
      tag.async = true;
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=AW-18545848708';
      document.head.appendChild(tag);
    }
  }

  var recent = new Map();
  function partnerClick(event) {
    // Ignore scripted clicks, right-click menus, and cancelled navigation.
    if (!event.isTrusted || event.defaultPrevented) return;
    if (event.type === 'click' && event.button !== 0) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    var target = event.target;
    var anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
    if (!anchor || anchor.hasAttribute('download')) return;
    var url;
    try { url = new URL(anchor.href, location.href); } catch (_) { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    if (url.hostname === location.hostname || /(^|\.)payrolltaxreform\.com$/i.test(url.hostname)) return;
    // Official sources and ordinary external links are not affiliate conversions.
    if (!anchor.relList.contains('sponsored') && !anchor.classList.contains('software-button')) return;
    var destination = url.origin + url.pathname;
    var now = Date.now();
    if (recent.has(destination) && now - recent.get(destination) < 1500) return;
    recent.set(destination, now);
    window.gtag('event', 'conversion', {
      send_to: 'AW-18545848708/cTvKCNnJ7LIdEITjrItF',
      transport_type: 'beacon'
    });
    // Do not cancel the click, delay navigation, or assign an invented sale value.
  }
  document.addEventListener('click', partnerClick);
  document.addEventListener('auxclick', partnerClick);
})();
