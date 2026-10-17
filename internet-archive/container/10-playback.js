boppa.playback.register({
  resolve: async function(track, { signal }) {
    if (!track.url) throw new Error('Missing stream URL');
    if (track.url.indexOf('ia://') !== 0) return { kind: 'direct', url: track.url };

    // Legacy ia://<identifier> URLs point at an item, not a file: pick its first audio file.
    const identifier = track.url.replace('ia://', '');
    const resp = await fetch('https://archive.org/metadata/' + encodeURIComponent(identifier) + '/files', { signal });
    const data = await resp.json();
    const files = data.result || [];
    const mp3s = files.filter(f => f.format === 'VBR MP3' || f.format === 'MP3' || f.format === '128Kbps MP3');
    const audioFiles = mp3s.length > 0 ? mp3s : files.filter(f => f.format === 'Ogg Vorbis');
    if (audioFiles.length === 0) throw new Error('Could not resolve audio file');
    return { kind: 'direct', url: 'https://archive.org/download/' + identifier + '/' + encodeURIComponent(audioFiles[0].name) };
  },
});
