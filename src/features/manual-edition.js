import { supabase } from '../data/supabase.js';
import { esc } from '../ui/format.js';
import { toast } from '../ui/feedback.js';
import { cleanIsbn, isValidIsbn } from '../../supabase/functions/_shared/edition-ranking.js';

export function openManualEdition(book, onSaved, onCancel) {
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="manual-edition-title"><h2 id="manual-edition-title">Add an edition</h2><p>${esc(book.title)} · ${esc(book.authors)}. Copy details from this edition or a reliable catalogue. Leave unknown details blank.</p><form class="form-stack" data-manual-edition>
    <label>ISBN<input class="input" name="isbn" required></label>
    <label>Publisher<input class="input" name="publisher" maxlength="200"></label>
    <label>Publication year<input class="input" name="year" type="number" min="1000" max="2100"></label>
    <label for="manual-edition-format">Format</label><select class="input" id="manual-edition-format" name="format"><option value="">Unknown</option>${['Hardcover','Paperback','eBook','Audiobook'].map(f=>`<option>${f}</option>`).join('')}</select>
    <label>Pages<input class="input" name="pages" type="number" min="1" max="10000"></label>
    <label>Language<input class="input" name="language" maxlength="100"></label>
    <label>Edition statement<input class="input" name="statement" maxlength="200"></label>
    <label>Source URL or physical-copy evidence<input class="input" name="evidence" maxlength="1000" required></label>
    <label><input type="checkbox" name="confirmed" required> I checked the ISBN, title and author against the source for this edition.</label>
    <p data-manual-error role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-manual-cancel>Cancel</button><button class="btn btn-primary" type="submit">Add edition</button></div>
  </form></section></div>`;
  root.querySelector('[data-manual-cancel]').addEventListener('click', onCancel);
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); const form=event.currentTarget, values=new FormData(form), button=form.querySelector('[type="submit"]');
    button.disabled=true; button.textContent='Saving…';
    try {
      const isbn=cleanIsbn(values.get('isbn'));
      if (!isValidIsbn(isbn)) throw new Error('Enter a valid ISBN-10 or ISBN-13.');
      const {error}=await supabase.rpc('add_manual_edition',{p_book_id:book.id,p_isbn:isbn,p_publisher:values.get('publisher')||null,p_year:values.get('year')?Number(values.get('year')):null,p_format:values.get('format')||null,p_pages:values.get('pages')?Number(values.get('pages')):null,p_language:values.get('language')||null,p_statement:values.get('statement')||null,p_evidence:values.get('evidence')});
      if(error)throw error;
      toast('Edition saved. Choose it from the catalogue.'); await onSaved();
    } catch(error) { form.querySelector('[data-manual-error]').textContent=error.message||'Could not add edition'; }
    finally {button.disabled=false;button.textContent='Add edition';}
  });
}
