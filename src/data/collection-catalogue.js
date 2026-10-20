// Public bibliographic facts only. Verified 2026-10-20; no reader data or
// personalised scores/orders belong in this file. See docs/collections-reading-paths.md.
const pc = 'https://www.prestonchild.com/books/';
const authors = 'Douglas Preston, Lincoln Child';
const pendergast = [
  ['relic','Relic',1995], ['reliquary','Reliquary',1997],
  ['cabinet','The Cabinet of Curiosities',2002], ['stilllife','Still Life with Crows',2003],
  ['brimstone','Brimstone',2004], ['danceofdeath','Dance of Death',2005],
  ['bookofthedead','The Book of the Dead',2006], ['wheelofdarkness','The Wheel of Darkness',2007],
  ['cemeterydance','Cemetery Dance',2009], ['feverdream','Fever Dream',2010],
  ['coldvengeance','Cold Vengeance',2011], ['twograves','Two Graves',2012],
  ['whitefire','White Fire',2013], ['bluelabyrinth','Blue Labyrinth',2014],
  ['crimsonshore','Crimson Shore',2015], ['obsidianchamber','The Obsidian Chamber',2016],
  ['endlessnight','City of Endless Night',2018], ['verses','Verses for the Dead',2018],
  ['crooked-river','Crooked River',2020], ['bloodless','Bloodless',2021],
  ['thecabinetofdrleng','The Cabinet of Dr. Leng',2023], ['angelofvengeance','Angel of Vengeance',2024],
  ['beginning','Pendergast: The Beginning',2026]
];
const nora = [
  ['old-bones','Old Bones',2019], ['the-scorpions-tail','The Scorpion’s Tail',2021],
  ['diablomesa','Diablo Mesa',2022], ['deadmountain','Dead Mountain',2023], ['badlands','Badlands',2025]
];
const work = ([slug,title,year], extra = {}) => ({ key:`pc:${slug}`, title, authors, publication_year:year, source_url:`${pc}${slug}/`, ...extra });
export const catalogueWorks = [
  ...pendergast.map(row=>work(row)), ...nora.map(row=>work(row)),
  work(['thunderhead','Thunderhead',1999]), work(['extraction','Extraction',2012],{format:'Short story'}),
  {key:'pc:dead-mans-journey',title:'Dead Man’s Journey',authors,publication_year:2027,publication_state:'forthcoming',source_url:'https://www.hachettebookgroup.com/titles/douglas-preston/dead-mans-journey/9781538765869/'},
  ...[['jurassic-park','Jurassic Park',1990],['the-lost-world','The Lost World',1995]].map(([key,title,year])=>({key:`crichton:${key}`,title,authors:'Michael Crichton',publication_year:year,source_url:'https://michaelcrichton.com/works/'})),
  ...[['wool','Wool',2011],['shift','Shift',2013],['dust','Dust',2013]].map(([key,title,year])=>({key:`howey:${key}`,title,authors:'Hugh Howey',publication_year:year,source_url:'https://hughhowey.com/series/silo/'}))
];
const member = (key,number=null) => ({work_key:key,official_number:number});
const pMembers = pendergast.map((row,i)=>member(`pc:${row[0]}`,i+1));
const nMembers = [...nora.map((row,i)=>member(`pc:${row[0]}`,i+1)),member('pc:dead-mans-journey',6)];
export const catalogueCollections = [
  {key:'preston-child',name:'Preston–Child',kind:'universe',description:'The connected world of Pendergast, Nora Kelly and Corrie Swanson. This catalogue covers their published novels, Thunderhead, Extraction and the announced Nora Kelly novel.',complete:true,source_url:`${pc}series/`,members:[member('pc:thunderhead'),...pMembers.map(m=>({...m,official_number:null})),member('pc:extraction'),...nMembers.map(m=>({...m,official_number:null}))]},
  {key:'nora-corrie',name:'Nora Kelly & Corrie Swanson',kind:'crossover',description:'Selected character connections from Thunderhead through Pendergast to the dedicated Nora Kelly series. A character collection, with no official series numbering of its own.',complete:false,source_url:'https://www.hachettebookgroup.com/series/douglas-preston/nora-kelly/',members:['thunderhead','cabinet','stilllife','danceofdeath','bookofthedead','cemeterydance','whitefire',...nora.map(r=>r[0]),'dead-mans-journey'].map(slug=>member(`pc:${slug}`))},
  {key:'pendergast',name:'Pendergast',kind:'series',description:'The published Agent Pendergast novels in official publication order, plus the unnumbered short story Extraction. The Beginning is the later-published origin story.',complete:true,source_url:`${pc}series/`,members:[...pMembers,member('pc:extraction')]},
  {key:'nora-kelly',name:'Nora Kelly',kind:'series',description:'The dedicated Nora Kelly and Corrie Swanson novels, beginning with Old Bones. Thunderhead and the Pendergast appearances belong to the connected crossover collection.',complete:true,source_url:'https://www.hachettebookgroup.com/series/douglas-preston/nora-kelly/',members:nMembers},
  {key:'jurassic-park',name:'Jurassic Park',kind:'series',description:'Michael Crichton’s two Jurassic Park novels in publication order.',complete:true,source_url:'https://michaelcrichton.com/works/',members:[member('crichton:jurassic-park',1),member('crichton:the-lost-world',2)]},
  {key:'silo',name:'Silo',kind:'series',description:'The core Silo trilogy: Wool, Shift and Dust. The omnibus volumes are counted once; separate short stories are outside this collection.',complete:true,source_url:'https://hughhowey.com/series/silo/',members:[member('howey:wool',1),member('howey:shift',2),member('howey:dust',3)]}
];
