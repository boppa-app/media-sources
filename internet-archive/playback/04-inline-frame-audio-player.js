// ==UserScript==
// @name         Inline Frame Audio Player
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';
  if (window === window.top) return;

  var audio = document.createElement('audio');
  audio.id = 'boppa-player';
  document.body.appendChild(audio);

  var currentLoadToken = null;
  var playingLoadToken = null;

  function reportEvent(evt, tokenOverride) {
    var tagged = {};
    for (var k in evt) tagged[k] = evt[k];
    tagged.loadToken = tokenOverride !== undefined ? tokenOverride : currentLoadToken;
    window.parent.postMessage({type: 'boppaEvent', event: tagged}, '*');
  }

  audio.addEventListener('playing', function() {
    window.parent.postMessage({type: 'boppaMediaPlaying', duration: audio.duration}, '*');
    reportEvent({type: 'play'});
  });
  audio.addEventListener('pause', function() {
    reportEvent({type: 'pause'});
  });
  audio.addEventListener('timeupdate', function() {
    if (playingLoadToken !== currentLoadToken) return;
    reportEvent({type: 'progress', currentTime: audio.currentTime, duration: audio.duration});
  });
  audio.addEventListener('loadedmetadata', function() {
    reportEvent({type: 'duration', value: audio.duration});
  });
  audio.addEventListener('ended', function() {
    reportEvent({type: 'finish'});
  });
  audio.addEventListener('error', function() {
    reportEvent({type: 'error', message: 'Audio element error: ' + (audio.error && audio.error.message)});
  });

  var placeholder = document.createElement('div');
  placeholder.id = audio.id;
  placeholder.className = audio.className;
  if (audio.parentNode) {
    audio.parentNode.replaceChild(placeholder, audio);
  }

  function resolveUrl(url) {
    if (!url || url.indexOf('ia://') !== 0) return Promise.resolve(url);
    var identifier = url.replace('ia://', '');
    return fetch('https://archive.org/metadata/' + encodeURIComponent(identifier) + '/files')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var files = data.result || [];
        var mp3s = files.filter(function(f) { return f.format === 'VBR MP3' || f.format === 'MP3' || f.format === '128Kbps MP3'; });
        var audioFiles = mp3s.length > 0 ? mp3s : files.filter(function(f) { return f.format === 'Ogg Vorbis'; });
        if (audioFiles.length === 0) return null;
        return 'https://archive.org/download/' + identifier + '/' + encodeURIComponent(audioFiles[0].name);
      })
      .catch(function() { return null; });
  }

  function loadTrack(trackData) {
    var thisLoadToken = (trackData && trackData.loadToken) || null;
    currentLoadToken = thisLoadToken;
    audio.pause();
    if (!trackData || !trackData.url) {
      reportEvent({type: 'error', message: 'Missing stream URL'}, thisLoadToken);
      return;
    }
    resolveUrl(trackData.url).then(function(streamUrl) {
      if (!streamUrl) {
        reportEvent({type: 'error', message: 'Could not resolve audio file'}, thisLoadToken);
        return;
      }
      playingLoadToken = thisLoadToken;
      audio.src = streamUrl;
      audio.play().catch(function(e) {
        reportEvent({type: 'error', message: 'Playback failed: ' + e.message}, thisLoadToken);
      });
    });
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'boppaPlay': audio.play(); break;
      case 'boppaPause': audio.pause(); break;
      case 'boppaSeek': audio.currentTime = msg.data / 1000; break;
      case 'boppaLoad': loadTrack(msg.data); break;
      case 'boppaMute': audio.muted = true; break;
      case 'boppaUnmute': audio.muted = false; break;
    }
  });

  window.parent.postMessage({type: 'boppaIframeReady'}, '*');
})();
