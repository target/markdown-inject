export const isCI = (): boolean => {
  const { CI } = process.env

  const falsyValues = [undefined, null, '', false, false.toString()]

  const isNotCi = falsyValues.some((falsyValue) => falsyValue === CI)

  return !isNotCi
}
