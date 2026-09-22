const identifier = params.id;

const resp = await fetch('https://archive.org/metadata/' + encodeURIComponent(identifier) + '/metadata');
const data = await resp.json();
const meta = data.result || {};

const filesResp = await fetch('https://archive.org/metadata/' + encodeURIComponent(identifier) + '/files');
const filesData = await filesResp.json();
const files = filesData.result || [];
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

postResult({
  id: identifier,
  title: meta.title || identifier,
  subtitle: meta.creator || 'Unknown Artist',
  year: meta.date ? parseInt(String(meta.date).substring(0, 4), 10) || null : null,
  lowResArtworkUrl: lowResArtworkUrl,
  highResArtworkUrl: highResArtworkUrl
});
