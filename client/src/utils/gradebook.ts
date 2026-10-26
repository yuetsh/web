export interface GradebookStudentIdentity {
  username: string
  classname: string
}

export function displayGradebookStudentName(student: GradebookStudentIdentity) {
  const generatedPrefix = `web${student.classname}`
  if (!student.classname || !student.username.startsWith(generatedPrefix)) {
    return student.username
  }
  return student.username.slice(generatedPrefix.length)
}
