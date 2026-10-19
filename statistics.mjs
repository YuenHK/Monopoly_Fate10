// Calendar boundaries are interpreted in Hong Kong time, independently of server TZ.
const DAY = 86400000, HK = 8 * 3600000;
const dayKey = value => new Date(new Date(value).getTime() + HK).toISOString().slice(0,10);
const invalid = () => { throw Object.assign(new Error('統計日期或範圍不正確'), {status:400}); };
export function periodRange(period = 'all', value, current = new Date()) {
  if (!['all','month','week'].includes(period)) invalid();
  if (period === 'all') return {period,start:null,end:null,label:'累積全部紀錄'};
  let key = value || dayKey(current);
  if (period === 'month' && /^\d{4}-\d{2}$/.test(key)) key += '-01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) invalid();
  const base = new Date(key + 'T00:00:00.000Z');
  if (!Number.isFinite(base.getTime()) || base.toISOString().slice(0,10) !== key) invalid();
  let start, end;
  if (period === 'month') {
    start = Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),1);
    end = Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,1);
  } else {
    start = base.getTime() - ((base.getUTCDay()+6)%7)*DAY;
    end = start+7*DAY;
  }
  return {period,start:new Date(start-HK).toISOString(),end:new Date(end-HK).toISOString(),label:period==='month'?`${base.getUTCFullYear()}年${base.getUTCMonth()+1}月`:`${new Date(start).toISOString().slice(0,10)} 至 ${new Date(end-DAY).toISOString().slice(0,10)}`};
}
export function countTimeline(draws, range) {
  const counts = new Map();
  for (const d of draws) if (d.kind === 'student' && !d.voided) {
    const key = dayKey(d.created).slice(0,range.period === 'all' ? 7 : 10);
    counts.set(key,(counts.get(key)||0)+1);
  }
  if (range.period !== 'all') {
    for (let t=new Date(range.start).getTime(); t<new Date(range.end).getTime(); t+=DAY) {
      const key = dayKey(t); if (!counts.has(key)) counts.set(key,0);
    }
  }
  return [...counts].sort(([a],[b])=>a.localeCompare(b)).map(([label,count])=>({label,count}));
}
