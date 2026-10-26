// Reviewed bibliographic assertions. Source scopes are deliberately explicit.
// Null means unverified, never an inferred publication year or position.
export const verifiedAt = '2026-10-26';
export const extraWorks = [];
export const extraCollections = [];
const slug = title => title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function series(key,name,authors,source,rows,{complete=true,kind='series',scope='Published novels',numbers=true,parent_key=null}={}) {
  const members = rows.map(([title,year,number,extra={}],i) => {
    const work_key = `${key}:${slug(title)}`;
    extraWorks.push({key:work_key,title,authors,publication_year:year,source_url:source,verified_at:verifiedAt,...extra});
    return {work_key,official_number:numbers ? number ?? i+1 : null};
  });
  extraCollections.push({key,name,kind,description:scope,complete,source_url:source,verified_at:verifiedAt,parent_key,members});
}
series('bobiverse','Bobiverse','Dennis E. Taylor','https://www.audible.com/press/press-releases/the-infinite-extent',[
  ['We Are Legion (We Are Bob)',2016],['For We Are Many',2017],['All These Worlds',2017],["Heaven's River",2020],['Not Till We Are Lost',2024],['The Infinite Extent',2026]
],{scope:'The six published Bobiverse novels. The Infinite Extent was published in audio in September 2026; print follows in 2027.'});
for(const w of extraWorks.filter(w=>w.key.startsWith('bobiverse:')&&w.title!=='The Infinite Extent')) w.source_url='https://www.simonandschuster.com/series/Bobiverse';
series('expanse','The Expanse','James S. A. Corey','https://www.hachettebookgroup.com/series/james-s-a-corey/the-expanse/',[
  ['Leviathan Wakes',2011],["Caliban's War",2012],["Abaddon's Gate",2013],['Cibola Burn',2014],['Nemesis Games',2015],["Babylon's Ashes",2016],['Persepolis Rising',2017],["Tiamat's Wrath",2019],['Leviathan Falls',2021]
],{scope:'The complete nine-novel sequence. Separate short fiction is outside this scoped novel catalogue.'});
series('heechee','Heechee','Frederik Pohl','https://www.penguinrandomhouse.com/books/132071/gateway-by-frederik-pohl/',[
  ['Gateway',1977,1],['Beyond the Blue Event Horizon',1980,2],['Heechee Rendezvous',1984,3],['The Annals of the Heechee',1987,4],['The Gateway Trip',1990,null],['The Boy Who Would Live Forever',2004,null]
],{complete:false,numbers:false,scope:'Verified Heechee novels and story collection. The first four positions are publisher documented; the collection and later novel remain unnumbered pending reconciliation of differing catalogues.'});
for(const [i,m] of extraCollections.at(-1).members.entries()) if(i<4) m.official_number=i+1;
for(const w of extraWorks.filter(w=>w.key.startsWith('heechee:'))) {
  if(w.title==='The Gateway Trip') w.source_url='https://www.baen.com/the-gateway-trip.html';
  else if(w.title==='The Boy Who Would Live Forever') w.source_url='https://www.publishersweekly.com/978-0-7653-1049-1';
  else w.source_url='https://books.google.com/books?vid=ISBN9780345282477';
}
series('revelation-space','Revelation Space','Alastair Reynolds','https://www.alastairreynolds.com/novels/',[
  ['Revelation Space',2000],['Chasm City',2001],['Redemption Ark',2002],['Absolution Gap',2003],['Diamond Dogs, Turquoise Days',2003],['Galactic North',2006],['Aurora Rising',2007,null,{aliases:['The Prefect']}],['Elysium Fire',2018],['Inhibitor Phase',2021],['Machine Vendetta',2024]
],{kind:'universe',numbers:false,complete:false,scope:'The Revelation Space shared universe, including Inhibitor and Prefect Dreyfus titles. No universe-wide official numbering. Newer collected short fiction requires catalogue reconciliation.'});
const rs = extraCollections.at(-1);
for(const [key,name,titles,url] of [
 ['inhibitor-trilogy','The Inhibitor Trilogy',['Revelation Space','Redemption Ark','Absolution Gap'],'https://www.hachettebookgroup.com/series/alastair-reynolds/the-inhibitor-trilogy/'],
 ['prefect-dreyfus','The Prefect Dreyfus Emergencies',['Aurora Rising','Elysium Fire','Machine Vendetta'],'https://www.hachettebookgroup.com/series/alastair-reynolds/the-prefect-dreyfus-emergencies/']
]) extraCollections.push({key,name,kind:'series',parent_key:rs.key,complete:true,verified_at:verifiedAt,source_url:url,description:'Published novels in the official subseries. Shared universe membership is separate.',members:titles.map((title,i)=>({work_key:`revelation-space:${slug(title)}`,official_number:i+1}))});
series('wayward-pines','Wayward Pines','Blake Crouch','https://blakecrouch.com/books/wayward-pines/',[['Pines',2012],['Wayward',2013],['The Last Town',2014]]);
series('children-of-time','Children of Time','Adrian Tchaikovsky','https://www.hachettebookgroup.com/series/adrian-tchaikovsky/children-of-time/',[['Children of Time',2015],['Children of Ruin',2019],['Children of Memory',2022],['Children of Strife',2026]],{scope:'The four published Children of Time novels as of October 2026.'});
series('thursday-murder-club','Thursday Murder Club','Richard Osman','https://www.penguinrandomhouse.com/series/TM9/a-thursday-murder-club-mystery/',[['The Thursday Murder Club',2020],['The Man Who Died Twice',2021],['The Bullet That Missed',2022],['The Last Devil to Die',2023],['The Impossible Fortune',2025]],{scope:'The five named published novels; an untitled sixth announcement is not a catalogue work.'});
series('rama','Rama','Arthur C. Clarke','https://www.penguinrandomhouse.com/series/A52/rama/',[
 ['Rendezvous with Rama',1973],['Rama II',1989,2,{authors:'Arthur C. Clarke, Gentry Lee'}],['The Garden of Rama',1991,3,{authors:'Arthur C. Clarke, Gentry Lee'}],['Rama Revealed',1993,4,{authors:'Arthur C. Clarke, Gentry Lee'}]
],{scope:'The four core Rama novels. The sequels credit Arthur C. Clarke and Gentry Lee; related solo novels require separate verification.'});
series('ready-player','Ready Player One','Ernest Cline','https://www.penguinrandomhouse.com/books/557223/ready-player-two-by-ernest-cline/',[['Ready Player One',2011],['Ready Player Two',2020]]);
series('sand','Sand','Hugh Howey','https://harper1styear.com/book-details/9780358726425/',[['Sand',2014],['Across the Sand',2022]],{scope:'The two published Sand Chronicles novels, counting the original serial once as the Sand omnibus.'});
series('beacon-23','Beacon 23','Hugh Howey','https://hughhowey.com/beacon-23/',[['Beacon 23',2015,null]],{numbers:false,scope:'The complete five-part serialized novel counted once as its omnibus. Component serial parts are not duplicate novels.'});
extraCollections.at(-1).catalogue_type='serialized_novel';
extraWorks.at(-1).serialized_novel=true;
series('hitchhikers','Hitchhiker\'s Guide','Douglas Adams','https://www.panmacmillan.com/series/the-hitchhikers-guide-to-the-galaxy/panmac26797',[
 ["The Hitchhiker's Guide to the Galaxy",1979],['The Restaurant at the End of the Universe',1980],['Life, the Universe and Everything',1982],['So Long, and Thanks for All the Fish',1984],['Mostly Harmless',1992]
],{scope:'Douglas Adams\' five novels. Eoin Colfer\'s continuation is outside this scoped author sequence.'});
series('languedoc','Languedoc Trilogy','Kate Mosse','https://www.panmacmillan.com/blogs/fiction/kate-mosse-the-burning-chambers-books-in-order',[
 ['Labyrinth',2005],['Sepulchre',2007],['Citadel',2012]
]);
series('semiosis','Semiosis','Sue Burke','https://sueburke.site/about/',[['Semiosis',2018],['Interference',2019],['Usurpation',2024]]);
series('nolan-moore','Nolan Moore','Michael Rutger','https://www.michaelrutger.com/',[['The Anomaly',2018,null],['The Possession',2019,null]],{numbers:false,scope:'The author\'s two Nolan Moore novels. No official series position asserted.'});
series('ice-limit','The Ice Limit','Douglas Preston, Lincoln Child','https://www.prestonchild.com/books/beyondtheicelimit/',[['The Ice Limit',2000,1],['Beyond the Ice Limit',2016,2]],{kind:'crossover',numbers:false,scope:'The original novel and its verified sequel, which is also Gideon Crew #4. Crossover membership carries no independent series number.'});
series('gideon-crew','Gideon Crew','Douglas Preston, Lincoln Child','https://www.hachettebookgroup.com/series/gideon-crew-series/',[["Gideon's Sword",2011],["Gideon's Corpse",2012],['The Lost Island',2014],['Beyond the Ice Limit',2016],['The Pharaoh Key',2018]]);
// Reuse the same underlying sequel work in both collections.
const duplicate=extraWorks.findIndex(w=>w.key==='gideon-crew:beyond-the-ice-limit');
extraWorks.splice(duplicate,1);
extraCollections.find(c=>c.key==='gideon-crew').members.find(m=>m.work_key==='gideon-crew:beyond-the-ice-limit').work_key='ice-limit:beyond-the-ice-limit';
series('cemetery-forgotten','The Cemetery of Forgotten Books','Carlos Ruiz Zafón','https://www.carlosruizzafon.co.uk/landing-page/carlos-ruiz-zafon/carlos-ruiz-zafon-books/',[
 ['The Shadow of the Wind',2001,null],["The Angel's Game",2008,null],['The Prisoner of Heaven',2011,null],['The Labyrinth of the Spirits',2016,null]
],{numbers:false,scope:'The four core Cemetery of Forgotten Books novels; separate short fiction is outside this scope.'});
series('delta-v','Delta-v','Daniel Suarez','https://daniel-suarez.com/',[['Delta-v',2019],['Critical Mass',2023]],{complete:false,scope:'Verified first two Delta-v novels. Future catalogue and further installments await confirmation.'});
series('apollo-murders','The Apollo Murders','Chris Hadfield','https://www.hachettebookgroup.com/series/chris-hadfield/the-apollo-murders-series/',[['The Apollo Murders',2021],['The Defector',2023],['Final Orbit',2025]],{scope:'The three published Apollo Murders novels.'});
series('andromeda','Andromeda','Michael Crichton','https://www.webwire.com/ViewPressRel.asp?aId=236616',[
 ['The Andromeda Strain',1969,1],['The Andromeda Evolution',2019,2,{authors:'Michael Crichton, Daniel H. Wilson'}]
],{scope:'The original novel and the officially authorised sequel by Daniel H. Wilson. Distinct from an author collection.'});
series('anomaly-quartet','The Anomaly Quartet','James Smythe','https://www.bardonchinese.com/booksite/375854/375854498.pdf',[
 ['The Explorer',2012],['The Echo',2014],['The Edge',2021],['The Ends',2022]
],{scope:'The four published Anomaly Quartet novels, corroborated by HarperCollins London Book Fair 2022 catalogue.'});
series('travis-chase','Travis Chase','Patrick Lee','https://www.publishersweekly.com/9780061958793',[
 ['The Breach',2009],['Ghost Country',2010],['Deep Sky',2011]
],{scope:'The completed three-novel Breach/Travis Chase trilogy. Later edition dates are not work publication dates.'});
series('ringworld','Ringworld','Larry Niven','https://larryniven.net/?q=a-biography',[
 ['Ringworld',1970],['The Ringworld Engineers',1980],['The Ringworld Throne',1996],["Ringworld's Children",2004]
],{scope:'The four core Ringworld novels, within the wider Known Space universe. Other Known Space works are outside this catalogue.'});
series('sam-reilly','Sam Reilly','Christopher Cartwright','https://www.christopher-cartwright.com/novels/',[
 ['The Last Airship',2015],['The Mahogany Ship',2015],['Atlantis Stolen',2016],['Rogue Wave',2016],['The Cassidy Project',2016],['The Nostradamus Equation',2017],['The Third Temple',2017],['The Aleutian Portal',2017],['Code to Extinction',2017],['The Ironclad Covenant',2018],['The Heisenberg Legacy',2018],['Omega Deep',2018],['The Holy Grail',2018],['The Phoenix Sanction',2018],['Habitat Zero',2018],['The Hunt for Excalibur',2019],['Ghost Ship',2019],['The Tomb of El Dorado',2019],['The Labyrinth Key',2019],['The Obsidian Chamber',2020],['Shangri-La',2020],["Alexander's Treasure",2020],['Valhalla Found',2021],["Medusa's Curse",2021],["Dragon's Breath",2022],['The Vostok Enigma',2022],['Skeleton Crew',2023],['The Midas Vault',2024],['The Medallion of Petra',2024],['The Relic Hunter',2024],['The Elixir of Life',2025],['Necropolis of the Gods',2025],['Abyss Codex',2025],["Caliburn's Fight",2025],['Icarus Adrift',2025],['The Shield of Hercules',2025],['Shōgun Resurrection',2025],['The Celtic Prophecy',2026],['The Eye of Horus',2026],['The Oblivion Protocol',2026]
],{complete:false,scope:'Forty published novels are bibliographically recorded. The author site is stale (lists 22); later titles are corroborated by external bibliographies and the complete catalogue remains under review.'});
for(const w of extraWorks.filter(w=>w.key.startsWith('sam-reilly:'))) w.source_url='https://www.fantasticfiction.com/c/christopher-cartwright/sam-reilly/';
for(const [title,authors,url] of [
 ['Pushing Ice','Alastair Reynolds','https://www.alastairreynolds.com/novels/'],
 ['Eversion','Alastair Reynolds','https://www.hachettebookgroup.com/landing-page/standalone-sff-books/'],
 ['The Last Astronaut','David Wellington','https://www.hachettebookgroup.com/landing-page/standalone-sff-books/'],
 ['Saturn Run','John Sandford, Ctein','https://www.johnsandford.org/'],
 ['Dark Matter','Blake Crouch','https://www.panmacmillan.com/blogs/science-fiction-and-fantasy/blake-crouch-books'],
 ['Recursion','Blake Crouch','https://www.panmacmillan.com/blogs/science-fiction-and-fantasy/blake-crouch-books'],
 ['Upgrade','Blake Crouch','https://www.panmacmillan.com/blogs/science-fiction-and-fantasy/blake-crouch-books']
]) extraWorks.push({key:`standalone:${slug(authors)}:${slug(title)}`,title,authors,source_url:url,verified_at:verifiedAt,standalone:true});
