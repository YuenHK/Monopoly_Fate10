// Keep the student's Chinese name separate from the identity shown in class.
export function studentKey(schoolClass, number) {
  return schoolClass ? `${schoolClass}/${number}` : String(number);
}
export function studentDisplay(student) {
  return student.school_class ? `${student.school_class} ${student.student_no || student.number} ${student.name}` : student.name;
}
export function publicStudent(student) {
  return {...student,number:student.student_no || student.number,display_id:studentDisplay(student)};
}
