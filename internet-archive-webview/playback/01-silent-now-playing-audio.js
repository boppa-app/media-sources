// ==UserScript==
// @name         Silent NowPlayingInfo Audio
// @run-at       document-end
// ==/UserScript==

(function() {
  if (window !== window.top) return;
  if (typeof ManagedMediaSource === 'undefined') return;

  // ManagedMediaSource (iOS's MSE variant (plain MediaSource not supported for
  // iOS WebKit)) lets the element report a long duration (set directly on
  // the MediaSource, independent of how much audio is actually appended) while
  // we only ever generate/append a few real seconds ahead of playback at a time.
  // "twos" (big-endian 16-bit PCM in fMP4) is used instead of WAV/data URIs so a
  // full, normal sample rate (44100Hz) can be used without the multi-hundred-MB
  // data URI a WAV of the same duration would require. ManagedMediaSource also
  // auto-evicts old buffered ranges, so no manual sourceBuffer.remove() is needed.
  var SAMPLE_RATE = 44100;
  var CHANNELS = 1;
  var TRACK_ID = 1;
  var FAKE_DURATION_SECONDS = 86400;
  var CHUNK_SECONDS = 2;
  var BUFFER_AHEAD_SECONDS = 6;

  function strBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function u32(v) {
    var b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0);
    return b;
  }
  function u16(v) {
    var b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v & 0xFFFF);
    return b;
  }
  function concat(arrays) {
    var total = 0;
    for (var i = 0; i < arrays.length; i++) total += arrays[i].byteLength;
    var out = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < arrays.length; i++) { out.set(arrays[i], offset); offset += arrays[i].byteLength; }
    return out;
  }
  function box(type, parts) {
    var payload = concat(parts);
    return concat([u32(8 + payload.byteLength), strBytes(type), payload]);
  }

  function buildFtyp() {
    return box('ftyp', [strBytes('isom'), u32(0), strBytes('isom'), strBytes('iso5'), strBytes('mp42')]);
  }
  function buildMvhd() {
    var parts = [u32(0), u32(0), u32(0), u32(SAMPLE_RATE), u32(0), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0)];
    var matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
    for (var i = 0; i < 9; i++) parts.push(u32(matrix[i]));
    for (var i = 0; i < 6; i++) parts.push(u32(0));
    parts.push(u32(2));
    return box('mvhd', parts);
  }
  function buildTkhd() {
    var parts = [u32(0x00000007), u32(0), u32(0), u32(TRACK_ID), u32(0), u32(0), u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0)];
    var matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
    for (var i = 0; i < 9; i++) parts.push(u32(matrix[i]));
    parts.push(u32(0));
    parts.push(u32(0));
    return box('tkhd', parts);
  }
  function buildMdhd() {
    return box('mdhd', [u32(0), u32(0), u32(0), u32(SAMPLE_RATE), u32(0), u16(0x55C4), u16(0)]);
  }
  function buildHdlr() {
    return box('hdlr', [u32(0), u32(0), strBytes('soun'), u32(0), u32(0), u32(0), strBytes('SoundHandler' + String.fromCharCode(0))]);
  }
  function buildSmhd() {
    return box('smhd', [u32(0), u16(0), u16(0)]);
  }
  function buildDinf() {
    var urlBox = box('url ', [u32(0x00000001)]);
    var dref = box('dref', [u32(0), u32(1), urlBox]);
    return box('dinf', [dref]);
  }
  function buildStsd() {
    var entry = [new Uint8Array(6), u16(1), u16(0), u16(0), u32(0), u16(CHANNELS), u16(16), u16(0), u16(0), u32(SAMPLE_RATE << 16)];
    var twos = box('twos', entry);
    return box('stsd', [u32(0), u32(1), twos]);
  }
  function buildStbl() {
    return box('stbl', [
      buildStsd(),
      box('stts', [u32(0), u32(0)]),
      box('stsc', [u32(0), u32(0)]),
      box('stsz', [u32(0), u32(0), u32(0)]),
      box('stco', [u32(0), u32(0)])
    ]);
  }
  function buildMinf() {
    return box('minf', [buildSmhd(), buildDinf(), buildStbl()]);
  }
  function buildMdia() {
    return box('mdia', [buildMdhd(), buildHdlr(), buildMinf()]);
  }
  function buildTrak() {
    return box('trak', [buildTkhd(), buildMdia()]);
  }
  function buildMvex() {
    return box('mvex', [box('trex', [u32(0), u32(TRACK_ID), u32(1), u32(0), u32(0), u32(0)])]);
  }
  function buildMoov() {
    return box('moov', [buildMvhd(), buildTrak(), buildMvex()]);
  }
  function buildInitSegment() {
    return concat([buildFtyp(), buildMoov()]);
  }

  var fragmentSequenceNumber = 0;
  var cumulativeFrames = 0;

  function buildFragment(pcmBytes, frameCount) {
    fragmentSequenceNumber++;
    var mfhd = box('mfhd', [u32(0), u32(fragmentSequenceNumber)]);
    var tfhd = box('tfhd', [u32(0x020000), u32(TRACK_ID)]);
    var tfdt = box('tfdt', [u32(0), u32(cumulativeFrames)]);
    var trunFlags = 0x000001 | 0x000100 | 0x000200;

    var sizingMoof = box('moof', [mfhd, box('traf', [tfhd, tfdt, box('trun', [u32(trunFlags), u32(1), u32(0), u32(frameCount), u32(pcmBytes.byteLength)])])]);
    var dataOffset = sizingMoof.byteLength + 8;
    var trun = box('trun', [u32(trunFlags), u32(1), u32(dataOffset), u32(frameCount), u32(pcmBytes.byteLength)]);
    var moof = box('moof', [mfhd, box('traf', [tfhd, tfdt, trun])]);
    var mdat = box('mdat', [pcmBytes]);

    cumulativeFrames += frameCount;
    return concat([moof, mdat]);
  }

  function generatePcmChunk(startFrame, frameCount) {
    var bytes = new Uint8Array(frameCount * CHANNELS * 2);
    var view = new DataView(bytes.buffer);
    for (var i = 0; i < frameCount; i++) {
      var t = (startFrame + i) / SAMPLE_RATE;
      // Faint real tone, not true silence, iOS suspends backgrounded audio it
      // detects as silent.
      var sample = Math.round(Math.sin(2 * Math.PI * 20 * t) * 3);
      view.setInt16(i * 2, sample, false);
    }
    return bytes;
  }

  var managedMediaSource = new ManagedMediaSource();
  var audio = document.createElement('audio');
  audio.id = 'boppa-nowplayinginfo-audio';
  audio.muted = true;
  audio.volume = 0.0001;
  // On iOS, ManagedMediaSource defers firing sourceopen until AirPlay/wireless
  // playback is disabled on the element (HTMLMediaElement::deferredMediaSourceOpenCanProgress()
  // gates on isWirelessPlaybackTargetDisabled() when managedMediaSourceNeedsAirPlay
  // is set), without this, sourceopen never fires and play() just aborts forever.
  audio.disableRemotePlayback = true;
  // Must be attached to the document before srcObject is assigned, otherwise
  // the resource-fetch algorithm never stabilizes and sourceopen never fires,
  // so any later play() request just aborts.
  document.body.appendChild(audio);
  audio.srcObject = managedMediaSource;

  var sourceBuffer = null;
  var nextFrameToGenerate = 0;
  var pendingAppend = null;

  function appendNext(data) {
    if (!sourceBuffer || sourceBuffer.updating) { pendingAppend = data; return; }
    sourceBuffer.appendBuffer(data);
  }

  function fillBuffer() {
    if (!sourceBuffer || sourceBuffer.updating) return;
    if (pendingAppend) { var d = pendingAppend; pendingAppend = null; appendNext(d); return; }
    var bufferedEnd = 0;
    if (sourceBuffer.buffered.length > 0) bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
    if (bufferedEnd >= audio.currentTime + BUFFER_AHEAD_SECONDS) return;

    var frameCount = CHUNK_SECONDS * SAMPLE_RATE;
    var pcmBytes = generatePcmChunk(nextFrameToGenerate, frameCount);
    nextFrameToGenerate += frameCount;
    appendNext(buildFragment(pcmBytes, frameCount));
  }

  managedMediaSource.addEventListener('sourceopen', function() {
    managedMediaSource.duration = FAKE_DURATION_SECONDS;
    sourceBuffer = managedMediaSource.addSourceBuffer('audio/mp4; codecs="twos"');
    sourceBuffer.addEventListener('updateend', fillBuffer);
    appendNext(buildInitSegment());
  });
  managedMediaSource.addEventListener('startstreaming', fillBuffer);
  setInterval(fillBuffer, 500);
})();
