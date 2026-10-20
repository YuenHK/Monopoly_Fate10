// Bundled videos only: a shuffled cycle plays each clip once before reshuffling.
export function shuffledCycle(items, previous, random = Math.random) {
  const cycle = [...new Set(items)];
  for (let i = cycle.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cycle[i], cycle[j]] = [cycle[j], cycle[i]];
  }
  if (cycle.length > 1 && cycle[0] === previous) [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
  return cycle;
}
export function createBackgroundPlaylist(video, { random = Math.random, onFailure = () => {} } = {}) {
  let theme = null, queue = [], previous = null, enabled = false, failed = new Set(), exhausted = false;
  video.autoplay = false; video.loop = false; video.muted = true; video.playsInline = true;
  const play = () => { if (enabled && !exhausted) video.play().catch(() => {}); };
  function advance() {
    if (!theme || exhausted) return;
    queue = queue.filter(src => !failed.has(src));
    if (!queue.length) queue = shuffledCycle((theme.videos || [theme.video]).filter(src => !failed.has(src)), previous, random);
    const src = queue.shift() || (!failed.has(theme.video) ? theme.video : null);
    if (!src) { exhausted = true; video.pause(); onFailure(); return; }
    previous = src; video.src = src; video.load(); play();
  }
  video.addEventListener('ended', () => { if (enabled) advance(); });
  video.addEventListener('error', () => { if (theme && video.error && previous) { failed.add(previous); advance(); } });
  return {
    setTheme(next) {
      if (theme?.id === next.id && theme?.libraryRevision === next.libraryRevision) return;
      video.pause(); theme = next; queue = []; failed = new Set(); exhausted = false;
      if(!(next.videos||[]).filter(Boolean).length&&!next.video){exhausted=true;previous=null;if(video.removeAttribute)video.removeAttribute('src');else video.src='';video.load();return;}
      advance();
    },
    setEnabled(value, { play: start = true } = {}) {
      enabled = Boolean(value);
      if (!enabled) video.pause(); else if (start) play();
    }
  };
}
