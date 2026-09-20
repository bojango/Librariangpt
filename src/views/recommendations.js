import { chrome } from '../ui/chrome.js';
import { cover, esc } from '../ui/format.js';

function recommendationRow(item) {
  const score = item.match_score_10 == null ? '' : `<span class="recommendation-editorial-score">${Number(item.match_score_10).toFixed(1)}/10 match</span>`;
  const strength = item.recommendation_strength ? `<span class="recommended-badge ${item.recommendation_strength === 'Wildcard' ? 'wildcard' : ''}">${esc(item.recommendation_strength)}</span>` : '';
  return `<article class="recommendation-editorial-card" data-recommendation-id="${esc(item.recommendation_id)}" tabindex="0" role="button" aria-label="Open recommendation for ${esc(item.title)}"><div class="recommendation-editorial-visual">${cover(item, 'recommendation-editorial-cover')}${score}</div><div class="recommendation-editorial-copy">${strength}<h2>${esc(item.title)}</h2><p class="recommendation-editorial-author">${esc(item.authors || 'Unknown author')}</p><p class="recommendation-editorial-reason">${esc(item.why_recommended || 'Recommended from your current Taste Profile and reading feedback.')}</p></div></article>`;
}

export function recommendationsView(state) {
  const items = state.aiRecommendations || [];
  const content = `<div class="recommendations-page"><header class="page-heading recommendations-heading"><p class="eyebrow">AI discovery</p><h1>Recommended for you</h1><p>${items.length} active ${items.length === 1 ? 'recommendation' : 'recommendations'}, shaped by your reading record.</p></header>${items.length ? `<div class="recommendation-editorial-list">${items.map(recommendationRow).join('')}</div>` : '<div class="empty-shelf">No active recommendations right now.</div>'}</div>`;
  return chrome(content, 'library');
}
