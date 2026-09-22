const identifier = params.id;

const url = 'https://archive.org/metadata/' + encodeURIComponent(identifier) + '/files';
const resp = await fetch(url);
const data = await resp.json();
const files = data.result || [];

const metaResp = await fetch('https://archive.org/metadata/' + encodeURIComponent(identifier) + '/metadata');
const meta = await metaResp.json();
const itemMeta = meta.result || {};
const albumArtist = itemMeta.creator || 'Unknown Artist';
const albumTitle = itemMeta.title || identifier;

function findRealArtworkFile(fileList) {
  const candidates = (fileList || []).filter(f => {
    const name = (f.name || '').toLowerCase();
    if (!/\.(jpe?g|png|gif)$/.test(name)) return false;
    if (name === '__ia_thumb.jpg') return false;
    return f.source === 'original';
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (parseInt(b.size, 10) || 0) - (parseInt(a.size, 10) || 0));
  return candidates[0].name;
}

let lowResArtworkUrl;
let highResArtworkUrl;
const realArtworkFileName = findRealArtworkFile(files);
if (realArtworkFileName) {
  const encodedPath = realArtworkFileName.split('/').map(encodeURIComponent).join('/');
  lowResArtworkUrl = 'https://archive.org/services/img/' + identifier;
  highResArtworkUrl = 'https://archive.org/download/' + identifier + '/' + encodedPath;
}

const audioFiles = files.filter(f =>
  f.format === 'VBR MP3' || f.format === 'MP3' || f.format === '128Kbps MP3'
  || f.format === 'Ogg Vorbis'
  || f.format === '64Kbps MP3'
);

const mp3Files = audioFiles.filter(f => f.format.includes('MP3'));
const toUse = mp3Files.length > 0 ? mp3Files : audioFiles;

const items = toUse.map((f, i) => ({
  id: identifier + '/' + f.name,
  title: f.title || f.name.replace(/\.[^.]+$/, '').replace(/^.*\//, ''),
  subtitle: f.artist || albumArtist,
  duration: f.length ? Math.round(parseFloat(f.length) * 1000) : null,
  lowResArtworkUrl: lowResArtworkUrl,
  highResArtworkUrl: highResArtworkUrl,
  url: 'https://archive.org/download/' + identifier + '/' + encodeURIComponent(f.name),
  artists: (f.artist || albumArtist) ? [{ id: f.artist || albumArtist, name: f.artist || albumArtist }] : [],
  albums: [{ id: identifier, title: albumTitle, lowResArtworkUrl: lowResArtworkUrl, highResArtworkUrl: highResArtworkUrl }]
}));

postResult({ items: items });
