import type { ZodError } from 'zod'

type CodeLocation = { file: string; line?: number; col?: number }

export const fileLocation = (codeLoc: CodeLocation): string => {
  const parts: (string | number)[] = [codeLoc.file]

  if (codeLoc.line !== undefined) {
    parts.push(codeLoc.line)
    if (codeLoc.col !== undefined) {
      parts.push(codeLoc.col)
    }
  }

  return parts.join(':')
}

// Source: https://github.com/colinhacks/zod/issues/5483#issuecomment-3582044411
// Lightly modified
export const prettifyZodErrors = (
  error: ZodError | ZodError[] | string,
): string => {
  if (typeof error === 'string') {
    error = JSON.parse(error) as ZodError
  }

  if (Array.isArray(error)) {
    return error.map((e) => prettifyZodErrors(e)).join('\n')
  }

  return error.issues
    .map((issue) => {
      let msg = `✖ ${issue.message}`
      if (issue.path?.length) {
        msg += `\n    → at ${issue.path.join('.')}`
      }
      if (issue.input !== undefined) {
        msg += `\n    → input: ${JSON.stringify(issue.input)}`
      }
      return msg
    })
    .join('\n')
}
