export const DEFAULT_SOUND_INTERVAL=6*60*60*1000;
export const DEFAULT_SOUND_RETRY=60*60*1000;
// Derive the next run from persisted attempt data, so restarting cannot reset backoff.
export function nextSoundSync(attempt,{intervalMs=DEFAULT_SOUND_INTERVAL,retryMs=DEFAULT_SOUND_RETRY}={},now=Date.now()){
  if(!attempt)return now;
  const last=Date.parse(attempt.finishedAt||attempt.at);if(!Number.isFinite(last))return now;
  const failures=Math.max(1,Math.min(10,Number(attempt.failures)||1));
  const delay=attempt.ok?intervalMs:Math.min(24*60*60*1000,retryMs*2**(failures-1));
  return last+delay;
}
