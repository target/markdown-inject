import glob from 'globby'
import fs from 'fs-extra'
import path from 'path'
import { exec } from 'child_process'
import Logger from './Logger'
import envCi from 'env-ci'

enum BlockSourceType {
  file = 'file',
  command = 'command',
}

export interface BlockOptions {
  value: string
  hideValue?: boolean
  environment?: NodeJS.ProcessEnv
  ignore?: boolean
  language?: string
  trim?: boolean
  type?: BlockSourceType
}

interface BlockInputOptions extends Omit<BlockOptions, 'type'> {
  type?: `${BlockSourceType}`
}

interface ReplaceOptions {
  blockPrefix: string
  followSymbolicLinks: boolean
  globPattern: string
  quiet: boolean
  useSystemEnvironment: boolean
}

const main = async (
  {
    blockPrefix,
    followSymbolicLinks,
    globPattern,
    quiet,
    useSystemEnvironment,
  }: ReplaceOptions = {
    blockPrefix: 'CODEBLOCK',
    followSymbolicLinks: true,
    globPattern: '**/*.md',
    quiet: false,
    useSystemEnvironment: true,
  }
): Promise<void> => {
  const logger = new Logger(quiet)

  const ciEnv = envCi()

  if (ciEnv.isCi && 'isPr' in ciEnv && ciEnv.isPr) {
    logger.warn(
      'markdown-inject does not run during pull request builds. Exiting with no changes.'
    )
    return
  }

  logger.group('Injecting Markdown Blocks')

  const markdownFiles = await glob(globPattern, {
    followSymbolicLinks,
    gitignore: true,
  })

  const processMarkdownFile = async (fileName: string) => {
    let originalFileContents
    try {
      originalFileContents = await fs.readFile(fileName, { encoding: 'utf-8' })
    } catch (err) {
      logger.error(`${fileName}: Error reading file`)
      throw err
    }

    let modifiedFileContents = originalFileContents

    let codeblockMatch: RegExpExecArray
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
            `(?<${commentType}_start_pragma>${commentStart}\\s*${blockPrefix}_START(?<${commentType}_name_ext>\\w*)\\s+(?<${commentType}_config>\\{(?:.|\\n)+?\\})\\s*${commentEnd}).*?(?<${commentType}_end_pragma>${commentStart}\\s*${blockPrefix}_END\\k<${commentType}_name_ext>\\s*${commentEnd})`
        )
        .join('|'),
      'gs'
    )

    while ((codeblockMatch = codeblockRegex.exec(modifiedFileContents))) {
      const matchGroups = Object.fromEntries(
        Object.entries(codeblockMatch.groups)
          .filter(([groupName]) =>
            groupName.startsWith(
              codeblockMatch.groups.html_config ? 'html_' : 'mdx_'
            )
          )
          .map(([groupName, groupValue]) => [
            groupName.replace(/^(html|mdx)_/, ''),
            groupValue,
          ])
      )
      try {
        let inputConfig: BlockInputOptions
        try {
          inputConfig = JSON.parse(matchGroups.config)
        } catch (err) {
          logger.error(`Error parsing config:\n${matchGroups.config}`)
          throw err
        }

        const resolvedType = BlockSourceType[inputConfig.type]

        const blockSourceTypes = {
          command: 'command',
          file: 'file',
        }

        if (inputConfig.type !== undefined && resolvedType === undefined) {
          throw new Error(
            `Unexpected "type" of "${
              inputConfig.type
            }". Valid types are ${Object.values(blockSourceTypes)
              .map((s) => `"${s}"`)
              .join(', ')}`
          )
        }

        const config: BlockOptions = {
          ...inputConfig,
          type: resolvedType,
        }

        const {
          type: blockSourceType = BlockSourceType.file,
          hideValue = false,
          trim = true,
          ignore = false,
          environment = {},
        } = config

        if (ignore) {
          blocksIgnored++
          totalBlocks++
          continue
        }

        let { language, value } = config

        if (!value) {
          throw new Error('No "value" was provided.')
        }

        const [originalBlock] = codeblockMatch
        const startPragma = matchGroups.start_pragma
        const endPragma = matchGroups.end_pragma

        let out: string

        if (blockSourceType === BlockSourceType.command) {
          out = await new Promise((resolve, reject) => {
            exec(
              value,
              { env: prepareEnvironment(environment, useSystemEnvironment) },
              (err, stdout) => {
                if (err) {
                  return reject(err)
                }
                return resolve(stdout)
              }
            )
          })
        } else {
          // BlockSourceType.file
          const fileLocation = path.resolve(path.dirname(fileName), value)
          out = await fs.readFile(fileLocation, { encoding: 'utf-8' })
          if (!language) {
            language = path.extname(fileLocation).replace(/^\./, '')
          }
          value = path.relative(process.cwd(), fileLocation)
        }

        if (!out || !out.trim()) {
          throw new Error('No content was returned.')
        }

        if (!language) {
          language = 'bash'
        }

        // Code blocks can start with an arbitrary length, and must end with at least the same.
        // This allows us to write ``` in our code blocks without inadvertently terminating them.
        // https://github.github.com/gfm/#example-94
        const codeblockFence = '~~~~~~~~~~'

        const checkFileName = fileName
        const prettierIgnore = checkFileName.includes('mdx')
          ? '{/* prettier-ignore */}'
          : '<!-- prettier-ignore -->'

        if (trim) {
          out = out.trim()
        }

        const newBlock = `${startPragma}
${prettierIgnore}
${codeblockFence}${language}${
          hideValue
            ? ''
            : `\n${
                blockSourceType === BlockSourceType.command ? '$' : 'File:'
              } ${value}\n`
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
          const post = input.substr(index + matchLength)

          modifiedFileContents = pre + newBlock + post
        }
      } catch (err) {
        const lines = codeblockMatch.input
          .slice(0, codeblockMatch.index)
          .split('\n')
        const lineNo = lines.length
        const col = lines.pop().length

        console.error(
          `Error processing codeblock at "${path.join(
            process.cwd(),
            fileName
          )}:${lineNo}:${col}":`
        )

        throw err
      }
    }

    if (modifiedFileContents !== originalFileContents) {
      await fs.writeFile(fileName, modifiedFileContents)
      logger.log(
        `${fileName}: ${blocksChanged} of ${totalBlocks} blocks changed (${blocksIgnored} ignored)`
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
        [itemChanges, itemIgnored, itemTotal]
      ) => [
        totalChanges + itemChanges,
        totalIgnored + itemIgnored,
        totalBlocks + itemTotal,
      ],
      [0, 0, 0]
    )

    if (totalBlocks === 0) {
      logger.warn(`No markdown files with "${blockPrefix}" pragmas located`)
      logger.groupEnd()
      return
    }

    logger.log(
      `Total: ${totalChanges} of ${totalBlocks} blocks (${totalIgnored} ignored)`
    )
  } catch (err) {
    logger.error(err)
    process.exitCode = 1
  }
  logger.groupEnd()
}

const prepareEnvironment = (
  providedEnvironment: NodeJS.ProcessEnv,
  useSystemEnvironment: boolean
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

export default main
