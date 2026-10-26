// Public source-backed bibliography; no reader records or Library state.
export const hardeningWorks=[
 {key:'hitchhikers:and-another-thing',title:'And Another Thing ...',authors:'Eoin Colfer',publication_year:2009,source_url:'https://www.penguin.co.uk/books/133267/and-another-thing--by-colfer-eoin/9780141931203',identifiers:['isbn:9780141931203']},
 {key:'expanse:memorys-legion',title:'Memory’s Legion',authors:'James S. A. Corey',publication_year:2022,format:'Short fiction collection',source_url:'https://www.hachette.co.uk/titles/daniel-abraham/memorys-legion/9781405552783/'},
 ...[
  ['improbable','Atlas of Improbable Places','Travis Elborough',2016],
  ['untamed','Atlas of Untamed Places','Chris Fitch',2017],
  ['unexpected','Atlas of Unexpected Places','Travis Elborough',2018],
  ['vanishing','Atlas of Vanishing Places','Travis Elborough',2019],
  ['forgotten','Atlas of Forgotten Places','Travis Elborough',2021],
  ['paranormal','Atlas of Paranormal Places','Evelyn Hollow',2024],
  ['ufo','Atlas of Unidentified Flying Objects','Andy McGrillen',2025]
 ].map(([key,title,authors,publication_year])=>({key:`unexpected-atlases:${key}`,title,authors,publication_year,source_url:'https://www.quarto.com/ourbooks/default.aspx?bookseriesid=1526&booktype=BY_SERIES_ID&currentpage=0'})),
 {key:'standalone:becky-chambers:to-be-taught-if-fortunate',title:'To Be Taught, If Fortunate',authors:'Becky Chambers',publication_year:2019,standalone:true,source_url:'https://www.hachette.com.au/becky-chambers/to-be-taught-if-fortunate-a-novella'},
 ...[
  ['Project Hail Mary','Andy Weir','https://www.bookseriesinorder.com/andy-weir/'],
  ['Shutter Island','Dennis Lehane','https://www.bookseriesinorder.com/dennis-lehane/'],
  ['The First Fifteen Lives of Harry August','Claire North','https://www.bookseriesinorder.com/claire-north/'],
  ['Wild Dark Shore','Charlotte McConaghy','https://www.bookseriesinorder.com/charlotte-mcconaghy/'],
  ['The Luminous Dead','Caitlin Starling','https://www.bookseriesinorder.com/caitlin-starling/']
  ,['Prey','Michael Crichton','https://www.bookseriesinorder.com/michael-crichton/']
  ,['Sphere','Michael Crichton','https://www.bookseriesinorder.com/michael-crichton/']
  ,['Timeline','Michael Crichton','https://www.bookseriesinorder.com/michael-crichton/']
  ,['Pirate Latitudes','Michael Crichton','https://www.bookseriesinorder.com/michael-crichton/']
  ,['Solaris','Stanisław Lem','https://www.bookseriesinorder.com/stanislaw-lem/']
  ,['The Invincible','Stanisław Lem','https://www.bookseriesinorder.com/stanislaw-lem/']
  ,['The Seven Deaths of Evelyn Hardcastle','Stuart Turton','https://www.bookseriesinorder.com/stuart-turton/']
  ,['Influx','Daniel Suarez','https://www.bookseriesinorder.com/daniel-suarez/']
  ,['Piranesi','Susanna Clarke','https://www.bookseriesinorder.com/susanna-clarke/']
  ,['Riptide','Douglas Preston, Lincoln Child','https://www.bookseriesinorder.com/douglas-preston/']
  ,['The Name of the Rose','Umberto Eco','https://www.bookseriesinorder.com/umberto-eco/']
  ,['The Historian','Elizabeth Kostova','https://www.bookseriesinorder.com/elizabeth-kostova/']
  ,['The Club Dumas','Arturo Pérez-Reverte','https://www.bookseriesinorder.com/arturo-perez-reverte/']
  ,['Contact','Carl Sagan','https://www.bookseriesinorder.com/carl-sagan/']
  ,['The Mountain in the Sea','Ray Nayler','https://www.bookseriesinorder.com/ray-nayler/']
  ,['The Hike','Drew Magary','https://www.bookseriesinorder.com/drew-magary/']
  ,['Roadside Picnic','Arkady Strugatsky, Boris Strugatsky','https://www.bookseriesinorder.com/arkady-boris-strugatsky/']
  ,['Whiteout!','Duncan Kyle','https://www.fictiondb.com/author/duncan-kyle~45668.htm']
 ].map(([title,authors,source_url])=>({key:`standalone:${authors.toLowerCase().replaceAll(' ','-')}:${title.toLowerCase().replaceAll(/[^a-z0-9]+/g,'-')}`,title,authors,standalone:true,verification:'explicit_standalone_bibliography',source_url}))
].map(w=>({...w,verified_at:'2026-10-26'}));
export const hardeningCollections=[{
 key:'unexpected-atlases',name:'Unexpected Atlases',kind:'series',complete:false,
 description:'The publisher’s official Unexpected Atlases series, across its credited authors. Seven verified works include the historical Atlas of Untamed Places listed by the publisher alongside its six current works. Reissues count once; historical catalogue completeness remains under review. No official numbering is asserted.',
 source_url:'https://www.quarto.com/ourbooks/default.aspx?bookseriesid=1526&booktype=BY_SERIES_ID&currentpage=0',verified_at:'2026-10-26',
 members:hardeningWorks.filter(w=>w.key.startsWith('unexpected-atlases:')).map(w=>({work_key:w.key,official_number:null}))
}];
const unexpected=hardeningWorks.find(w=>w.key==='unexpected-atlases:unexpected');
unexpected.aliases=['Atlas of the Unexpected'];
unexpected.identifiers=['isbn:9781781317167','isbn:9780711290815'];
hardeningWorks.find(w=>w.key==='unexpected-atlases:untamed').source_url='https://www.quarto.com/books/9780711290846/Atlas-of-Forgotten-Places';
for(const key of ['improbable','unexpected','vanishing','forgotten']) hardeningWorks.find(w=>w.key===`unexpected-atlases:${key}`).bibliographic_source_url='https://traviselborough.co.uk/books-3/';
hardeningWorks.find(w=>w.key==='unexpected-atlases:untamed').bibliographic_source_url='https://openlibrary.org/books/OL29342227M/Atlas_of_Untamed_Places';
hardeningWorks.find(w=>w.key==='unexpected-atlases:untamed').identifiers=['isbn:9781781316771'];
hardeningWorks.find(w=>w.key==='unexpected-atlases:paranormal').source_url='https://www.quarto.com/books/9780711287969/Atlas-of-Paranormal-Places';
hardeningWorks.find(w=>w.key==='unexpected-atlases:ufo').source_url='https://www.quarto.com/books/9781836006022/Atlas-of-Unidentified-Flying-Objects';
