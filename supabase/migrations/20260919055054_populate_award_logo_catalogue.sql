with logo_catalogue(name, logo_file, logo_alt, official_url, logo_source_url, logo_source_name) as (
  values
    ('Arthur C. Clarke Award', 'arthur-c-clarke-award-v1.webp', 'Arthur C. Clarke Award logo', 'https://www.clarkeaward.com/', 'https://www.clarkeaward.com/assets/images/image01.jpg?v=250a215e', 'Arthur C. Clarke Award'),
    ('Boardman Tasker Prize for Mountain Literature', 'boardman-tasker-prize-v1.webp', 'Boardman Tasker Prize logo', 'https://www.boardmantasker.com/', 'https://images.squarespace-cdn.com/content/v1/558c0d86e4b0c093c661fa38/1461762285535-WVUXMUYW69M4J33FGIWF/BT+LOGO-01+copy2.png?format=1500w', 'Boardman Tasker Charitable Trust'),
    ('Books Are My Bag Readers Award', 'books-are-my-bag-readers-awards-v1.webp', 'Books Are My Bag Readers Awards logo', 'https://www.booksellers.org.uk/industryinfo/industryinfo/latestnews/Books-Are-My-Bag-Readers-Awards-2021-winners-annou', 'https://www.booksellers.org.uk/getmedia/fac3d2b0-0e60-45d5-a1d4-3295b05d7943/BAMB-PLAIN-RA_logo-01.aspx?width=349&height=350', 'Booksellers Association'),
    ('Books Are My Bag Readers’ Choice', 'books-are-my-bag-readers-awards-v1.webp', 'Books Are My Bag Readers Awards logo', 'https://www.booksellers.org.uk/industryinfo/industryinfo/latestnews/Books-Are-My-Bag-Readers-Awards-2021-winners-annou', 'https://www.booksellers.org.uk/getmedia/fac3d2b0-0e60-45d5-a1d4-3295b05d7943/BAMB-PLAIN-RA_logo-01.aspx?width=349&height=350', 'Booksellers Association'),
    ('Hugo Award', 'hugo-award-v1.webp', 'Hugo Award logo', 'https://www.thehugoawards.org/', 'https://www.thehugoawards.org/content/Logos/Hugo_Logo_1_300px.png', 'World Science Fiction Society'),
    ('Independent Publisher Book Award', 'independent-publisher-book-award-v1.webp', 'Independent Publisher Book Awards logo', 'https://ippyawards.com/', 'https://ippyawards.com/wp-content/uploads/2025/07/cropped-Ippy-updated-black.png', 'Independent Publisher Book Awards'),
    ('National Outdoor Book Award', 'national-outdoor-book-award-v1.webp', 'National Outdoor Book Award winner medallion', 'https://www.noba-web.org/', 'https://www.noba-web.org/Images/NOBAWin250.jpg', 'National Outdoor Books Awards Foundation'),
    ('Nebula Award', 'nebula-award-v1.webp', 'Nebula Awards logo', 'https://nebulas.sfwa.org/', 'https://nebulas.sfwa.org/wp-content/themes/nebulaawards/images/nebula-logo-2020.png', 'Science Fiction and Fantasy Writers Association')
)
update public.accolades as accolade
set logo_url = 'https://fbbpovieqfsjunmqtxvf.supabase.co/storage/v1/object/public/award-logos/' || logo.logo_file,
    logo_alt = logo.logo_alt,
    official_url = logo.official_url,
    logo_source_url = logo.logo_source_url,
    logo_source_name = logo.logo_source_name
from logo_catalogue as logo
where accolade.name = logo.name;

do $$
begin
  if (
    select count(*)
    from public.accolades
    where name = any (array[
      'Arthur C. Clarke Award',
      'Boardman Tasker Prize for Mountain Literature',
      'Books Are My Bag Readers Award',
      'Books Are My Bag Readers’ Choice',
      'Hugo Award',
      'Independent Publisher Book Award',
      'National Outdoor Book Award',
      'Nebula Award'
    ])
      and logo_url like 'https://fbbpovieqfsjunmqtxvf.supabase.co/storage/v1/object/public/award-logos/%'
      and logo_alt is not null
      and official_url is not null
      and logo_source_url is not null
      and logo_source_name is not null
  ) <> 8 then
    raise exception 'Expected eight verified accolade catalogue records to receive logo metadata';
  end if;
end
$$;
