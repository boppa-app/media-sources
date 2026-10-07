const query = params.query;
const page = params.previousResult?.page ? params.previousResult.page + 1 : 1;

const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent('mediatype:audio AND creator:(' + query + ')')
  + '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=downloads&fl[]=format'
  + '&sort[]=downloads+desc'
  + '&rows=50'
  + '&page=' + page
  + '&output=json';

const resp = await fetch(url);
const data = await resp.json();
const docs = data.response?.docs || [];

// Archive.org auto-derives a waveform PNG + spectrogram + item-tile thumb for every
// audio upload, real uploaded cover art is tagged 'JPEG' or 'Item Image' in this list.
// Without this check, items with no real art would show the waveform as artwork.
function hasRealArtwork(format) {
  const formats = Array.isArray(format) ? format : (format ? [format] : []);
  return formats.includes('JPEG') || formats.includes('Item Image');
}

const seen = new Set();
const items = [];
for (const d of docs) {
  const name = d.creator;
  if (!name || seen.has(name)) continue;
  seen.add(name);
  items.push({
    id: name,
    name: name,
    lowResArtworkUrl: hasRealArtwork(d.format) ? 'https://archive.org/services/img/' + d.identifier : undefined
  });
}

const result = { items: items };
if (docs.length === 50) {
  result.page = page;
}
postResult(result);
