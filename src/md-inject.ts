import { exec } from 'node:child_process'
import { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'

import envCi from 'env-ci'
import { z } from 'zod'

import Logger from './Logger.ts'
import { fileLocation, prettifyZodErrors } from './utils.ts'

const BlockSourceType = { file: 'file', command: 'command' } as const
const BlockSchema = z.union([
  z.object({
    ignore: z.literal(true),
  }),
  z.object({
    value: z.string(),
    hideValue: z.boolean().optional().default(false),
    environment: z.record(z.string(), z.string()).optional().default({}),
    ignore: z.boolean().optional().default(false),
    language: z.string().optional(),
    trim: z.boolean().optional().default(true),
    type: z.enum(Object.values(BlockSourceType)).default('file').optional(),
  }),
])

interface ReplaceOptions {
  blockPrefix: string
  globPattern: string
  quiet: boolean
  useSystemEnvironment: boolean
}

const main = async (
  { blockPrefix, globPattern, quiet, useSystemEnvironment }: ReplaceOptions = {
    blockPrefix: 'CODEBLOCK',
    globPattern: '**/*.md',
    quiet: false,
    useSystemEnvironment: true,
  },
): Promise<void> => {
  const logger = new Logger(quiet)

  const ciEnv = envCi()

  if (ciEnv.isCi && 'isPr' in ciEnv && ciEnv.isPr) {
    logger.warn(
      'markdown-inject does not run during pull request builds. Exiting with no changes.',
    )
    return
  }

  logger.group('Injecting Markdown Blocks')

  const markdownFiles: string[] = []
  const gitignorePatterns = await readGitignorePatterns()

  for await (const file of fs.glob(globPattern, {
    cwd: process.cwd(),
    withFileTypes: false,
    exclude: <T extends Dirent | string>(fileName: T) =>
      isGitignored(
        fileName instanceof Dirent ? fileName.name : fileName,
        gitignorePatterns,
      ),
  }) as AsyncIterable<string>) {
    markdownFiles.push(file)
  }

  const processMarkdownFile = async (fileName: string) => {
    let originalFileContents
    try {
      originalFileContents = await fs.readFile(fileName, { encoding: 'utf-8' })
    } catch (err) {
      logger.error(`${fileName}: Error reading file`)
      throw err
    }

    let modifiedFileContents = originalFileContents

    let blocksChanged = 0
    let blocksIgnored = 0
    let totalBlocks = 0

    const comment = {
      html: {
        start: '<!-{2,}',
        end: '-{2,}>',
      },
      mdx: {
        start: '\\{\\s*/\\*',
        end: '\\*/\\s*\\}',
      },
    } as const
    const codeblockRegex = new RegExp(
      Object.entries(comment)
        .map(
          ([commentType, { start: commentStart, end: commentEnd }]) =>
            `(?<${commentType}_start_pragma>${commentStart}\\s*${blockPrefix}_START(?<${commentType}_name_ext>\\w*)\\s+(?<${commentType}_config>\\{(?:.|\\n)+?\\})\\s*${commentEnd}).*?(?<${commentType}_end_pragma>${commentStart}\\s*${blockPrefix}_END\\k<${commentType}_name_ext>\\s*${commentEnd})`,
        )
        .join('|'),
      'gs',
    )

    let codeblockMatch: RegExpExecArray | null
    while ((codeblockMatch = codeblockRegex.exec(modifiedFileContents))) {
      const codeblockMatchGroups = codeblockMatch?.groups

      if (!codeblockMatchGroups) {
        continue
      }

      const matchGroups = Object.fromEntries(
        Object.entries(codeblockMatchGroups)
          .filter(([groupName]) =>
            groupName.startsWith(
              codeblockMatchGroups.html_config ? 'html_' : 'mdx_',
            ),
          )
          .map(([groupName, groupValue]) => [
            groupName.replace(/^(html|mdx)_/, ''),
            groupValue,
          ]),
      )
      try {
        let inputConfig: unknown
        try {
          inputConfig = JSON.parse(matchGroups.config)
        } catch (err) {
          logger.error(`Error parsing config:\n${matchGroups.config}`)
          throw err
        }

        const blockParseResult = await BlockSchema.safeParseAsync(inputConfig, {
          reportInput: true,
        })
        if (!blockParseResult.success) {
          const errMsg = [
            'Invalid config:',
            JSON.stringify(inputConfig, null, 2),
            '',
            'Issues:',
            prettifyZodErrors(blockParseResult.error),
            '',
          ]

          throw new Error(errMsg.join('\n'))
        }
        const blockConfig = blockParseResult.data

        if (blockConfig.ignore) {
          blocksIgnored++
          totalBlocks++
          continue
        }

        if (!blockConfig.value) {
          throw new Error('No "value" was provided.')
        }

        const [originalBlock] = codeblockMatch
        const startPragma = matchGroups.start_pragma
        const endPragma = matchGroups.end_pragma

        let out: string

        if (blockConfig.type === BlockSourceType.command) {
          out = await new Promise((resolve, reject) => {
            exec(
              blockConfig.value,
              {
                env: prepareEnvironment(
                  blockConfig.environment,
                  useSystemEnvironment,
                ),
              },
              (err, stdout) => {
                if (err) {
                  return reject(err)
                }
                return resolve(stdout)
              },
            )
          })
        } else {
          // BlockSourceType.file
          const fileLocation = path.resolve(
            path.dirname(fileName),
            blockConfig.value,
          )
          out = await fs.readFile(fileLocation, { encoding: 'utf-8' })
          if (!blockConfig.language) {
            blockConfig.language = path.extname(fileLocation).replace(/^\./, '')
          }
          blockConfig.value = path.relative(process.cwd(), fileLocation)
        }

        if (!out || !out.trim()) {
          throw new Error('No content was returned.')
        }

        if (!blockConfig.language) {
          blockConfig.language = 'bash'
        }

        // Code blocks can start with an arbitrary length, and must end with at least the same.
        // This allows us to write ``` in our code blocks without inadvertently terminating them.
        // https://github.github.com/gfm/#example-94
        const codeblockFence = '~~~~~~~~~~'

        const checkFileName = fileName
        const prettierIgnore = checkFileName.includes('mdx')
          ? '{/* prettier-ignore */}'
          : '<!-- prettier-ignore -->'

        if (blockConfig.trim) {
          out = out.trim()
        }

        const newBlock = `${startPragma}
${prettierIgnore}
${codeblockFence}${blockConfig.language}${
          blockConfig.hideValue
            ? ''
            : `\n${
                blockConfig.type === BlockSourceType.command ? '$' : 'File:'
              } ${blockConfig.value}\n`
        }
${out}
${codeblockFence}

${endPragma}`

        totalBlocks++
        if (newBlock !== originalBlock) {
          blocksChanged++

          const { input, index } = codeblockMatch
          const matchLength = codeblockMatch[0].length

          const pre = input.substring(0, index)
          const post = input.slice(index + matchLength)

          modifiedFileContents = pre + newBlock + post
          // Realign lastIndex: the replaced string may differ in length from the
          // original match, so the next exec must start at the correct offset in
          // the new string rather than the old one.
          codeblockRegex.lastIndex = pre.length + newBlock.length
        }
      } catch (err) {
        const lines = codeblockMatch.input
          .slice(0, codeblockMatch.index)
          .split('\n')

        const codeblockLocation = fileLocation({
          file: path.join(process.cwd(), fileName),
          line: lines.length,
          col: lines.pop()?.length,
        })

        logger.error(`Error processing codeblock at "${codeblockLocation}":`)
        if (err instanceof Error) {
          logger.error(err.message)
        } else {
          logger.error(err)
        }

        process.exitCode = 1
      }
    }

    if (modifiedFileContents !== originalFileContents) {
      await fs.writeFile(fileName, modifiedFileContents)
      logger.log(
        `${fileName}: ${blocksChanged} of ${totalBlocks} blocks changed (${blocksIgnored} ignored)`,
      )
    }

    return [blocksChanged, blocksIgnored, totalBlocks]
  }

  try {
    const results = await Promise.all(markdownFiles.map(processMarkdownFile))

    if (results.length === 0) {
      logger.warn('No markdown files identified')
      logger.groupEnd()
      return
    }

    const [totalChanges, totalIgnored, totalBlocks] = results.reduce(
      (
        [totalChanges, totalIgnored, totalBlocks],
        [itemChanges, itemIgnored, itemTotal],
      ) => [
        totalChanges + itemChanges,
        totalIgnored + itemIgnored,
        totalBlocks + itemTotal,
      ],
      [0, 0, 0],
    )

    if (totalBlocks === 0) {
      logger.warn(`No markdown files with "${blockPrefix}" pragmas located`)
      logger.groupEnd()
      return
    }

    logger.log(
      `Total: ${totalChanges} of ${totalBlocks} blocks (${totalIgnored} ignored)`,
    )
  } catch (err) {
    logger.error(err)
    process.exitCode = 1
  }
  logger.groupEnd()
}

const prepareEnvironment = (
  providedEnvironment: NodeJS.ProcessEnv,
  useSystemEnvironment: boolean,
) => {
  const systemEnvironment = useSystemEnvironment ? process.env : {}
  providedEnvironment = Object.entries(providedEnvironment)
    .map(([key, value]) => {
      const valueEnvMatch = /^\$(\w+)$/.exec(value || '')
      if (valueEnvMatch) {
        const envKey = valueEnvMatch[1]
        value = process.env[envKey]
      }
      return [key, value] as const
    })
    .reduce((agg, [k, v]) => ({ ...agg, [k]: v }), {})

  return {
    ...systemEnvironment,
    FORCE_COLOR: '0',
    ...providedEnvironment,
  }
}

const readGitignorePatterns = async (): Promise<string[]> => {
  try {
    const contents = await fs.readFile(path.join(process.cwd(), '.gitignore'), {
      encoding: 'utf-8',
    })
    return contents
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  } catch {
    return []
  }
}

const isGitignored = (entry: string, patterns: string[]): boolean => {
  const parts = entry.split(path.sep)
  return patterns.some((pattern) => {
    // Strip leading slash (root-anchored patterns are treated the same here)
    const p = pattern.replace(/^\//, '')
    // Match any path segment or the full relative path
    return (
      parts.some((part) => part === p) ||
      entry === p ||
      entry.startsWith(p + path.sep)
    )
  })
}

export default main
