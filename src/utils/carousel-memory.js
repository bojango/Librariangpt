export function currentReadingSignature(cardIds) {
  return JSON.stringify(cardIds.map(id => String(id)));
}

export function carouselStart(cardIds, savedCardId, savedSignature) {
  const signature = currentReadingSignature(cardIds);
  const savedIndex = savedSignature === signature ? cardIds.findIndex(id => String(id) === savedCardId) : -1;
  return { signature, index: Math.max(0, savedIndex) };
}
