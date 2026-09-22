// ==UserScript==
// @name         Media Session Bridge
// @run-at       document-end
// ==/UserScript==

(function() {
  if (window !== window.top) return;
  if (!('mediaSession' in navigator)) return;

  var trackDurationSeconds = 0;
  var hasReceivedInitialPlaying = false;
  var artworkLoadToken = 0;

  function wrapArtworkUrl(url) {
    return 'boppa-artwork://cache?url=' + encodeURIComponent(url);
  }

  function isArtworkUrlReachable(url) {
    if (!url) return Promise.resolve(false);
    var wrapped = wrapArtworkUrl(url);
    return new Promise(function(resolve) {
      var settled = false;
      var img = new Image();

      function settle(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        img.onload = null;
        img.onerror = null;
        resolve(result);
      }

      var timeoutId = setTimeout(function() {
        img.src = '';
        settle(false);
      }, 4000);

      img.onload = function() { settle(true); };
      img.onerror = function() { settle(false); };
      img.src = wrapped;
    });
  }

  var frame = document.getElementById('player-frame');
  var iframeReady = false;
  var pendingCommands = [];

  function sendToIframe(msg) {
    if (frame && frame.contentWindow && iframeReady) {
      frame.contentWindow.postMessage(msg, '*');
    } else {
      pendingCommands.push(msg);
    }
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'boppaIframeReady') {
      iframeReady = true;
      var cmds = pendingCommands.slice();
      pendingCommands = [];
      for (var i = 0; i < cmds.length; i++) sendToIframe(cmds[i]);
    } else if (msg.type === 'boppaMediaPlaying') {
      if (msg.duration) trackDurationSeconds = msg.duration;
      if (!hasReceivedInitialPlaying) {
        hasReceivedInitialPlaying = true;
        navigator.mediaSession.setPositionState({ duration: trackDurationSeconds, playbackRate: 1.0 });
        navigator.mediaSession.setActionHandler('seekto', function(details) {
          if (window.boppaSeek) window.boppaSeek((details && details.seekTime != null ? details.seekTime : 0) * 1000);
        });
      }
    } else if (msg.type === 'boppaEvent') {
      postEvent(msg.event);
    }
  });

  window.boppaLoad = function(trackData) {
    hasReceivedInitialPlaying = false;
    var nowplayinginfo = document.getElementById('boppa-nowplayinginfo-audio');
    navigator.mediaSession.setActionHandler('seekto', null);
    if (nowplayinginfo) {
      nowplayinginfo.muted = false;
      nowplayinginfo.play();
    }
    sendToIframe({type: 'boppaUnmute'});
    navigator.mediaSession.playbackState = 'playing';

    var thisLoadToken = ++artworkLoadToken;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackData.title || '',
      artist: trackData.subtitle || '',
      artwork: [{
        src: wrapArtworkUrl(trackData.highResArtworkUrl || trackData.lowResArtworkUrl || 'https://cdn.boppa.app/no-artwork.png')
      }]
    });

    if (trackData.highResArtworkUrl) {
      isArtworkUrlReachable(trackData.highResArtworkUrl).then(function(highResOk) {
        if (thisLoadToken !== artworkLoadToken || highResOk) return;
        var fallbackUrl = trackData.lowResArtworkUrl || 'https://cdn.boppa.app/no-artwork.png';
        navigator.mediaSession.metadata = new MediaMetadata({
          title: trackData.title || '',
          artist: trackData.subtitle || '',
          artwork: [{ src: wrapArtworkUrl(fallbackUrl) }]
        });
      });
    }

    trackDurationSeconds = trackData.duration ? trackData.duration / 1000 : 0;
    if (trackDurationSeconds) {
      navigator.mediaSession.setPositionState({ duration: trackDurationSeconds, playbackRate: 0.0001, position: 0 });
      console.log('boppaLoad: set mediaSession duration to', trackDurationSeconds);
    }

    sendToIframe({type: 'boppaLoad', data: trackData});
  };

  window.boppaPlay = function() {
    var nowPlayingInfoAudioElement = document.getElementById('boppa-nowplayinginfo-audio');
    if (nowPlayingInfoAudioElement) {
      nowPlayingInfoAudioElement.muted = false;
      nowPlayingInfoAudioElement.play();
    }
    navigator.mediaSession.playbackState = 'playing';
    sendToIframe({type: 'boppaPlay'});
  };

  window.boppaPause = function() {
    var nowPlayingInfoAudioElement = document.getElementById('boppa-nowplayinginfo-audio');
    if (nowPlayingInfoAudioElement) nowPlayingInfoAudioElement.pause();
    navigator.mediaSession.playbackState = 'paused';
    sendToIframe({type: 'boppaPause'});
  };

  window.boppaSeek = function(ms) {
    if (trackDurationSeconds) {
      navigator.mediaSession.setPositionState({ duration: trackDurationSeconds, position: Math.max(0, ms / 1000) });
    }
    sendToIframe({type: 'boppaSeek', data: ms});
  };

  window.boppaStop = function() {
    var nowPlayingInfoAudioElement = document.getElementById('boppa-nowplayinginfo-audio');
    if (nowPlayingInfoAudioElement) {
      nowPlayingInfoAudioElement.muted = true;
      nowPlayingInfoAudioElement.pause();
    }
    navigator.mediaSession.playbackState = 'paused';
    if (navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.artwork = [{ src: wrapArtworkUrl('https://cdn.boppa.app/empty.png') }];
    }
    sendToIframe({type: 'boppaMute'});
    sendToIframe({type: 'boppaPause'});
  };
})();
