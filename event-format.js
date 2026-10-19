export function parseEventText(value) {
  return String(value).split(/[;；\r\n]+/).map(s=>s.trim()).filter(Boolean);
}
export function formatEventText(items) {
  return items.length ? items.join('；\n\n')+'；' : '';
}
