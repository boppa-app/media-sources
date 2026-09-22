const creator = params.id;

const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent('mediatype:audio AND creator:"' + creator + '"')
  + '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=downloads'
  + '&sort[]=downloads+desc'
  + '&rows=15'
  + '&page=1'
  + '&output=json';

const resp = await fetch(url);
const data = await resp.json();
const docs = data.response?.docs || [];

const albums = docs.map(d => ({
  id: d.identifier,
  title: d.title || d.identifier,
  subtitle: d.creator || 'Unknown Artist',
  year: d.date ? parseInt(d.date.substring(0, 4), 10) || null : null,
  lowResArtworkUrl: 'https://archive.org/services/img/' + d.identifier,
  highResArtworkUrl: 'https://archive.org/services/img/' + d.identifier
}));

postResult({ albums: albums, songs: [] });
