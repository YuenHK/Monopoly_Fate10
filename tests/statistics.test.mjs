import test from 'node:test';
import assert from 'node:assert/strict';
import {periodRange,countTimeline} from '../statistics.mjs';
import {parseEventText,formatEventText} from '../event-format.js';
test('Hong Kong month boundaries and leap year',()=>{
  assert.deepEqual(periodRange('month','2026-10'),{period:'month',start:'2026-09-30T16:00:00.000Z',end:'2026-10-31T16:00:00.000Z',label:'2026年10月'});
  assert.equal(periodRange('month','2024-02').end,'2024-02-29T16:00:00.000Z');
  for(const value of ['2026-02-30','2026-13','bad'])assert.throws(()=>periodRange('month',value));
});
test('Monday weeks cross year boundaries correctly',()=>{
  const r=periodRange('week','2027-01-01');
  assert.equal(r.start,'2026-12-27T16:00:00.000Z');assert.equal(r.end,'2027-01-03T16:00:00.000Z');
  assert.equal(periodRange('week','2026-10-18').end,'2026-10-18T16:00:00.000Z');
  assert.equal(periodRange('week','2026-10-19').start,'2026-10-18T16:00:00.000Z');
});
test('time series counts students in HK days and includes zero days',()=>{
  const range=periodRange('week','2026-10-19');
  const series=countTimeline([{kind:'student',created:'2026-10-18T16:00:00Z'},{kind:'student',created:'2026-10-19T01:00:00Z'},{kind:'chance',created:'2026-10-19T01:00:00Z'}],range);
  assert.equal(series.length,7);assert.deepEqual(series[0],{label:'2026-10-19',count:2});assert.equal(series[6].count,0);
});
test('event editor accepts old lines and both semicolons without empty events',()=>{
  const items=['可重抽一次','以英文回答','可選一首歌'];
  assert.deepEqual(parseEventText('可重抽一次；\n\n以英文回答;\r\n可選一首歌；'),items);
  assert.equal(formatEventText(items),'可重抽一次；\n\n以英文回答；\n\n可選一首歌；');
  assert.deepEqual(parseEventText(formatEventText(items)),items);assert.deepEqual(parseEventText('；;\n '),[]);
});
