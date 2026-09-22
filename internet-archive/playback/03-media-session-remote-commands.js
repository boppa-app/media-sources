// ==UserScript==
// @name         Media Session Remote Commands
// @run-at       document-end
// ==/UserScript==

(function() {
  if (window !== window.top) return;
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.setActionHandler('play', function() {
    if (window.boppaPlay) window.boppaPlay();
  });
  navigator.mediaSession.setActionHandler('pause', function() {
    if (window.boppaPause) window.boppaPause();
  });
  navigator.mediaSession.setActionHandler('previoustrack', function() {
    postEvent({type: 'previoustrackCommand'});
  });
  navigator.mediaSession.setActionHandler('nexttrack', function() {
    postEvent({type: 'nexttrackCommand'});
  });
  navigator.mediaSession.setActionHandler('seekbackward', null);
  navigator.mediaSession.setActionHandler('seekforward', null);
  navigator.mediaSession.setActionHandler('seekto', null);
})();
