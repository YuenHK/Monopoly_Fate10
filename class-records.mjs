// Convert historical per-lesson storage to a single persistent record per class.
// Draw IDs, timestamps, student snapshots and avatars remain unchanged.
export async function mergeClassRecords(db) {
  await db.exec('BEGIN IMMEDIATE');
  try {
    await db.exec('CREATE TABLE IF NOT EXISTS lesson_aliases(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id))');
    const classes=await db.all('SELECT id,archived FROM classes');
    for(const c of classes) {
      const records=await db.all('SELECT * FROM lessons WHERE class_id=? ORDER BY created DESC,id',c.id);
      if(!records.length)continue;
      const latest=await db.get('SELECT d.lesson_id,d.kind FROM draws d JOIN lessons l ON l.id=d.lesson_id WHERE l.class_id=? ORDER BY d.created DESC,d.id DESC LIMIT 1',c.id);
      const keep=records.find(r=>r.id===latest?.lesson_id)||records[0];
      for(const old of records.filter(r=>r.id!==keep.id)) {
        const draws=await db.all('SELECT id,request_id FROM draws WHERE lesson_id=?',old.id);
        for(const draw of draws)await db.run('UPDATE draws SET lesson_id=?,request_id=? WHERE id=?',keep.id,old.id+'/'+draw.request_id,draw.id);
        await db.run('INSERT INTO lesson_aliases(id,class_id) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id',old.id,c.id);
        await db.run('DELETE FROM lessons WHERE id=?',old.id);
      }
      await db.run('UPDATE lessons SET name=?,closed=?,must_student=? WHERE id=?','班別累積記錄',Number(Boolean(c.archived)),latest?Number(latest.kind!=='student'):keep.must_student,keep.id);
    }
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS one_record_per_class ON lessons(class_id)');
    await db.exec('COMMIT');
  }catch(error){await db.exec('ROLLBACK');throw error;}
}
