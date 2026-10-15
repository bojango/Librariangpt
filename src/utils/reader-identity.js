// The saved headline is also the identity used by ordinary timeline entries.
export function readerIdentity(state) {
  const metadata = state.session?.user?.user_metadata || {};
  const displayName = state.profile?.display_name || metadata.full_name || metadata.name || metadata.display_name || metadata.user_name || 'Reader';
  const handle = state.profile?.handle || state.profile?.display_name || (metadata.user_name ? `@${String(metadata.user_name).replace(/^@/, '')}` : displayName);
  return { displayName, handle };
}
