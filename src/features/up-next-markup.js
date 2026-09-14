import { esc } from '../ui/format.js';

function managerRow(item, index, length) {
  return `<div class="queue-manager-row" data-queue-id="${item.queue_id}"><div class="queue-manager-order">${index + 1}</div><div class="queue-manager-copy"><strong>${esc(item.title)}</strong><span>${esc(item.authors || '')}</span><small>${item.source === 'Manual' ? 'Your pick' : 'Librarian pick'}${item.locked ? ' · locked' : ''}</small></div><div class="queue-manager-actions"><button type="button" data-queue-move="up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-queue-move="down" ${index === length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-queue-lock="${item.locked ? '0' : '1'}">${item.locked ? 'Unlock' : 'Lock'}</button><button type="button" data-queue-remove>Remove</button></div></div>`;
}

export function upNextManagerRows(queue) {
  return queue.map((item, index) => managerRow(item, index, queue.length)).join('');
}
