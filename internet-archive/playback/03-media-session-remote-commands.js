// ==UserScript==
// @name         Media Session Remote Commands
// @run-at       document-end
// ==/UserScript==

(function() {
  if (window !== window.top) return;
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.setActionHandler('previoustrack', function() {
    boppa.postEvent({type: 'previoustrackCommand'});
  });
  navigator.mediaSession.setActionHandler('nexttrack', function() {
    boppa.postEvent({type: 'nexttrackCommand'});
  });
  navigator.mediaSession.setActionHandler('seekbackward', null);
  navigator.mediaSession.setActionHandler('seekforward', null);
  navigator.mediaSession.setActionHandler('seekto', null);
})();
