const creator = params.id;
// Resume state: which page of the album search we're on, which album within that
// page we were mid-way through, and which file within that album's file list.
// A single album can contain more tracks than fit in one result batch, so both
// docIndex and fileIndex are needed to resume without skipping or repeating tracks.
const searchPage = params.previousResult?.searchPage || 1;
const startDocIndex = params.previousResult?.docIndex || 0;
const startFileIndex = params.previousResult?.fileIndex || 0;

const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent('mediatype:audio AND creator:"' + creator + '"')
  + '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=downloads'
  + '&sort[]=downloads+desc'
  + '&rows=20'
  + '&page=' + searchPage
  + '&output=json';

const searchResp = await fetch(url);
const searchData = await searchResp.json();
const docs = searchData.response?.docs || [];

// Archive.org auto-derives a waveform PNG + spectrogram + item-tile thumb for every
// audio upload, real uploaded cover art is an original-source image file.
// Without this check, items with no real art would show the waveform as artwork.
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

const allItems = [];
let nextDocIndex = null;
let nextFileIndex = null;

for (let i = startDocIndex; i < docs.length; i++) {
  const d = docs[i];
  const filesResp = await fetch('https://archive.org/metadata/' + encodeURIComponent(d.identifier) + '/files');
  const filesData = await filesResp.json();
  const files = filesData.result || [];

  const mp3s = files.filter(f => f.format === 'VBR MP3' || f.format === 'MP3' || f.format === '128Kbps MP3');
  const audioFiles = mp3s.length > 0 ? mp3s : files.filter(f => f.format === 'Ogg Vorbis');

  let lowResArtworkUrl;
  let highResArtworkUrl;
  const realArtworkFileName = findRealArtworkFile(files);
  if (realArtworkFileName) {
    const encodedPath = realArtworkFileName.split('/').map(encodeURIComponent).join('/');
    lowResArtworkUrl = 'https://archive.org/services/img/' + d.identifier;
    highResArtworkUrl = 'https://archive.org/download/' + d.identifier + '/' + encodedPath;
  }

  const fromFile = (i === startDocIndex) ? startFileIndex : 0;
  for (let j = fromFile; j < audioFiles.length; j++) {
    const f = audioFiles[j];
    allItems.push({
      id: d.identifier + '/' + f.name,
      title: f.title || f.name.replace(/\.[^.]+$/, '').replace(/^.*\//, ''),
      subtitle: d.creator || 'Unknown Artist',
      duration: f.length ? Math.round(parseFloat(f.length) * 1000) : null,
      lowResArtworkUrl: lowResArtworkUrl,
      highResArtworkUrl: highResArtworkUrl,
      url: 'https://archive.org/download/' + d.identifier + '/' + encodeURIComponent(f.name),
      albums: [{ id: d.identifier, title: d.title || d.identifier, lowResArtworkUrl: lowResArtworkUrl, highResArtworkUrl: highResArtworkUrl }]
    });
    if (allItems.length >= 30) {
      nextDocIndex = j + 1 < audioFiles.length ? i : i + 1;
      nextFileIndex = j + 1 < audioFiles.length ? j + 1 : 0;
      break;
    }
  }
  if (nextDocIndex !== null) break;
}

const result = { items: allItems };
if (nextDocIndex !== null) {
  // Stopped mid-page (mid-album or between albums): resume here on the same search page.
  result.searchPage = searchPage;
  result.docIndex = nextDocIndex;
  result.fileIndex = nextFileIndex;
} else if (docs.length === 20) {
  // Consumed every album on this search page. A full page means more albums may exist.
  result.searchPage = searchPage + 1;
  result.docIndex = 0;
  result.fileIndex = 0;
}
postResult(result);
