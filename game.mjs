import { randomInt } from 'node:crypto';

export function createBoard(students) {
  const sum = Math.ceil((students.length + 16) / 2);
  const width = Math.max(5, Math.ceil(sum * 0.6));
  const height = Math.max(4, sum - width);
  const cells = students.map(s => ({ type: 'student', studentId: s.id }));
  const extras = 2 * (width + height) - 4 - cells.length;
  for (let i = 0; i < extras; i++) cells.push({ type: i % 2 ? 'fate' : 'chance' });
  for (let i = cells.length - 1; i > 0; i--) { const j = randomInt(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return { width, height, cells, currentIndex: 0 };
}
export function sameRoster(board, students) {
  const ids = board?.cells.filter(c => c.type === 'student').map(c => c.studentId).sort();
  return JSON.stringify(ids) === JSON.stringify(students.map(s => s.id).sort());
}
export function nextDraw(board, mustStudent, mode, algorithm = 'dice', choose = randomInt) {
  if(algorithm==='equal'){
    const targets=board.cells.map((cell,index)=>({cell,index})).filter(t=>!mustStudent||t.cell.type==='student');
    if(!targets.length)throw new Error('沒有可抽取的學生');
    const target=targets[choose(targets.length)];
    const steps=board.cells.length+(target.index-board.currentIndex+board.cells.length)%board.cells.length;
    return {dice:null,algorithm,steps,fromIndex:board.currentIndex,targetIndex:target.index,cell:target.cell};
  }
  const dice = mode === 'dice' ? [randomInt(1, 7), randomInt(1, 7)] : null;
  let steps = dice ? dice[0] + dice[1] : board.cells.length + randomInt(board.cells.length);
  while (mustStudent && board.cells[(board.currentIndex + steps) % board.cells.length].type !== 'student') steps++;
  const targetIndex = (board.currentIndex + steps) % board.cells.length;
  return { dice, steps, fromIndex: board.currentIndex, targetIndex, cell: board.cells[targetIndex] };
}
