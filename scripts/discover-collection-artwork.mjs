// Explicit read-only discovery from the work's author/publisher pages. This
// produces display metadata only; it never updates canonical books or editions.
import {mkdir,writeFile} from 'node:fs/promises';
import {catalogueWorks} from '../src/data/collection-catalogue.js';
import {isValidIsbn} from '../src/utils/text.js';
await mkdir('output/collections',{recursive:true});
const seriesUrl='https://www.prestonchild.com/books/series/';
const index=await(await fetch(seriesUrl)).text();
const linkedCovers=new Map();
for(const match of index.matchAll(/<a\b[^>]*href="(\/books\/[^"?#]+\/)"[^>]*>([\s\S]*?)<\/a>/g)) {
 const src=match[2].match(/<img\b[^>]*src="([^"]+)"/)?.[1];
 if(src) linkedCovers.set(new URL(match[1],seriesUrl).href,new URL(src,seriesUrl).href);
}
const output={};
const individualPages={
 'crichton:jurassic-park':{url:'https://michaelcrichton.com/works/jurassic-park/',image:/Jurassic-Park-1990-700x1024\.jpg/},
 'crichton:the-lost-world':{url:'https://michaelcrichton.com/works/the-lost-world/',image:/\/The-Lost-World\.jpg/},
 'howey:wool':{url:'https://hughhowey.com/books/wool/',image:/WOOL_hi-res\.jpg/},
 'howey:shift':{url:'https://hughhowey.com/books/shift/',image:/\/Shift-Front-Cover\.jpg/},
 'howey:dust':{url:'https://hughhowey.com/books/dust/',image:/DUST-PLC-1200\.jpg/}
};
for(const work of catalogueWorks) {
 // Use individual work pages, never a series landing-page social image.
 const individual=individualPages[work.key],source=individual?.url || work.source_url;
 const response=await fetch(source);
 if(!response.ok) throw new Error(`Source unavailable: ${source}`);
 const html=await response.text();
 const meta=[...html.matchAll(/<meta\b([^>]+)>/gi)].map(m=>m[1]);
 let image=individual?[...html.matchAll(/<img\b[^>]*src="([^"]+)"/gi)].map(m=>m[1]).find(url=>individual.image.test(url)):linkedCovers.get(source);
 if(image) image=image.replaceAll('&#038;','&').replaceAll('&amp;','&');
 if(!image) {
  const tag=meta.find(text=>/property=["']og:image["']/i.test(text));
  image=tag?.match(/content=["']([^"']+)/i)?.[1]?.replaceAll('&amp;','&');
  if(image) image=new URL(image,source).href;
 }
 // A root-domain social image is not evidence of a book cover.
 if(!image || !image.startsWith('https://') || new URL(image).pathname==='/') continue;
 const isbn=!individual&&(source.match(/\/(97[89]\d{10})\//)?.[1]
  || [...html.matchAll(/(?:amazon\.[a-z.]+\/(?:[^"'<>\s]*?\/)?(?:dp|gp\/product)\/)(\d{9}[\dX])/gi)].map(m=>m[1]).find(isValidIsbn));
 output[work.key]={cover_url:image,source_url:source,verified_at:'2026-10-21',...(isbn&&isValidIsbn(isbn)?{[isbn.length===13?'isbn13':'isbn10']:isbn}:{})};
}
await writeFile('src/data/collection-artwork.js',`// Cover URLs verified against the linked author/publisher page on 21 October 2026.\n// Display fallback only: never overrides a canonical or selected edition cover.\nexport const collectionArtwork = ${JSON.stringify(output,null,2)};\n`);
await writeFile('output/collections/artwork-discovery.json',JSON.stringify(output,null,2));
console.log(`Discovered source-backed artwork for ${Object.keys(output).length} of ${catalogueWorks.length} works.`);
