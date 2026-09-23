const automaticOwnedStatuses = new Set(['Recommended', 'Wishlist']);

export function buildLibraryPayload(formData, currentBook = {}) {
  const nextStatus = String(formData.get('overall_status') || '');
  const nextOwnership = String(formData.get('ownership_status') || '');
  const payload = {
    ownership_status: nextOwnership,
    reading_priority: formData.get('reading_priority'),
    started_date: formData.get('started_date'),
    completed_date: formData.get('completed_date'),
    current_page: formData.get('current_page'),
    display_edition_id: formData.get('display_edition_id')
  };

  const shouldUseRpcOwnedTransition = automaticOwnedStatuses.has(currentBook.overall_status)
    && currentBook.ownership_status !== 'Owned'
    && nextOwnership === 'Owned'
    && nextStatus === currentBook.overall_status;

  // admin_edit_book deliberately infers Owned - Unread when overall_status is
  // omitted. Keep explicit statuses in every other case so intentional choices
  // such as Currently Reading, Read or Paused always win.
  if (!shouldUseRpcOwnedTransition) payload.overall_status = nextStatus;
  return payload;
}
