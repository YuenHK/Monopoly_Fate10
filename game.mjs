import { randomInt } from 'node:crypto';

export function createBoard(students) {
  const total=students.length+20+(students.length%2);
  const sum=(total+4)/2;
  const width=Math.max(5,Math.ceil(sum*.6)),height=sum-width;
  const cells=students.map(s=>({type:'student',studentId:s.id}));
  for(let i=0;i<10;i++)cells.push({type:'chance'},{type:'fate'});
  // A rectangular perimeter has an even number of cells; the start is never a draw target.
  if(students.length%2)cells.push({type:'start'});
  for (let i = cells.length - 1; i > 0; i--) { const j = randomInt(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return { width, height, cells, currentIndex: 0 };
}
export function sameRoster(board, students) {
  const ids = board?.cells.filter(c => c.type === 'student').map(c => c.studentId).sort();
  return JSON.stringify(ids) === JSON.stringify(students.map(s => s.id).sort());
}
export function hasEventCounts(board){
 return board?.cells?.filter(c=>c.type==='chance').length===10&&board.cells.filter(c=>c.type==='fate').length===10;
}
export function nextDraw(board, mustStudent, mode, algorithm = 'dice', choose = randomInt) {
  if(mustStudent&&!board.cells.some(c=>c.type==='student'))throw new Error('沒有可抽取的學生');
  const eligible=cell=>cell.type!=='start'&&(!mustStudent||cell.type==='student');
  if(algorithm==='equal'){
    const targets=board.cells.map((cell,index)=>({cell,index})).filter(t=>eligible(t.cell));
    if(!targets.length)throw new Error('沒有可抽取的學生');
    const target=targets[choose(targets.length)];
    const steps=board.cells.length+(target.index-board.currentIndex+board.cells.length)%board.cells.length;
    return {dice:null,algorithm,steps,fromIndex:board.currentIndex,targetIndex:target.index,cell:target.cell};
  }
  const dice = mode === 'dice' ? [randomInt(1, 7), randomInt(1, 7)] : null;
  let steps = dice ? dice[0] + dice[1] : board.cells.length + randomInt(board.cells.length);
  while (!eligible(board.cells[(board.currentIndex + steps) % board.cells.length])) steps++;
  const targetIndex = (board.currentIndex + steps) % board.cells.length;
  return { dice, steps, fromIndex: board.currentIndex, targetIndex, cell: board.cells[targetIndex] };
}
