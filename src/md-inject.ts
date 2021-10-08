import glob from 'globby'
import fs from 'fs-extra'
import path from 'path'
import { exec } from 'child_process'
import Logger from './Logger'
import { isCI } from './utils'

enum BlockSourceType {
  file = 'file',
  command = 'command',
}

interface BlockOptions {
  value: string
  hideValue?: boolean
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
  forceWrite: boolean
  globPattern: string
  quiet: boolean
}

const main = async (
  {
    blockPrefix,
    followSymbolicLinks,
    forceWrite,
    globPattern,
    quiet,
  }: ReplaceOptions = {
    blockPrefix: 'CODEBLOCK',
    followSymbolicLinks: true,
    forceWrite: false,
    globPattern: '**/*.md',
    quiet: false,
  }
): Promise<void> => {
  const logger = new Logger(quiet)

  const writeChangedBlocks = forceWrite || !isCI()
  logger.group(
    writeChangedBlocks
      ? 'Injecting Markdown Blocks'
      : 'Checking Markdown Blocks'
  )

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

    let codeblockMatch
    let blocksChanged = 0
    let blocksIgnored = 0
    let totalBlocks = 0

    const codeblockRegex = new RegExp(
      `(?<start_pragma><!--\\s*${blockPrefix}_START(?<name_ext>\\w*)\\s+(?<config>\\{(?:.|\\n)+?\\})\\s*-->)(?:.|\\s)*?(?<end_pragma><!--\\s*${blockPrefix}_END\\k<name_ext>\\s*-->)`,
      'g'
    )

    while ((codeblockMatch = codeblockRegex.exec(modifiedFileContents))) {
      let config: BlockOptions
      try {
        const inputConfig: BlockInputOptions = JSON.parse(
          codeblockMatch.groups.config
        )
        config = {
          ...inputConfig,
          type: BlockSourceType[inputConfig.type],
        }
      } catch (err) {
        logger.error(
          `${fileName}: Error parsing config ${codeblockMatch.groups.config}`
        )
        throw err
      }

      const blockSourceTypes = {
        command: 'command',
        file: 'file',
      }

      const {
        type: blockSourceType = BlockSourceType.file,
        hideValue = false,
        trim = true,
        ignore = false,
      } = config

      if (ignore) {
        blocksIgnored++
        totalBlocks++
        continue
      }

      let { language, value } = config

      if (!value) {
        throw new Error(`${fileName}: All codeblocks must contain a "value"`)
      }

      const [originalBlock] = codeblockMatch
      const startPragma = codeblockMatch.groups.start_pragma
      const endPragma = codeblockMatch.groups.end_pragma

      let out: string
      switch (blockSourceType) {
        case BlockSourceType.command: {
          out = await new Promise((resolve, reject) => {
            exec(
              value,
              { env: { ...process.env, FORCE_COLOR: '0' } },
              (err, stdout) => {
                if (err) {
                  return reject(err)
                }
                return resolve(stdout)
              }
            )
          })
          break
        }
        case BlockSourceType.file: {
          const fileLocation = path.resolve(path.dirname(fileName), value)
          out = await fs.readFile(fileLocation, { encoding: 'utf-8' })

          if (!language) {
            language = path.extname(fileLocation).replace(/^\./, '')
          }

          value = path.relative(process.cwd(), fileLocation)

          break
        }
        default:
          throw new Error(
            `${fileName} contains unexpected codeblock type "${blockSourceType}". Valid types are ${Object.values(
              blockSourceTypes
            )
              .map((s) => `"${s}"`)
              .join(', ')}`
          )
      }

      if (!language) {
        language = 'bash'
      }

      // Code blocks can start with an arbitrary length, and must end with at least the same.
      // This allows us to write ``` in our code blocks without inadvertently terminating them.
      // https://github.github.com/gfm/#example-94
      const codeblockFence = '~~~~~~~~~~'

      const prettierIgnore = '<!-- prettier-ignore -->'

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
    }

    if (modifiedFileContents !== originalFileContents) {
      if (writeChangedBlocks) {
        await fs.writeFile(fileName, modifiedFileContents)
      }
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

    if (!writeChangedBlocks && totalChanges !== 0) {
      logger.log()
      logger.error(
        'ERROR: Block updates detected in CI.\nNo block changes were written.\nCall with --force-write to bypass.'
      )
      logger.log()
      process.exitCode = 1
    }
  } catch (err) {
    logger.log()
    logger.error(err)
    logger.log()
    process.exitCode = 1
  }
  logger.groupEnd()
}

export default main
