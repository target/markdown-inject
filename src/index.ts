#!/usr/bin/env node

import { Command } from 'commander'
import injectMarkdown from './md-inject'

const { name, version } = require('../package.json')

const program = new Command()
program
  .version(version, '-v, --version')
  .name(name)
  .arguments('[globPattern]')
  .option(
    '-b, --block-prefix <prefix>',
    'specifies the prefix for START and END HTML comment blocks',
    'CODEBLOCK'
  )
  .option(
    '-n, --no-follow-symbolic-links',
    'prevents globs from following symlinks'
  )
  .option('-q, --quiet', 'emits no console log statements', false)
  .option(
    '-e, --no-system-environment',
    'prevents "command"s from receiving system environment',
    false
  )
  .description('Add file or command output to markdown documents.')
  .usage(
    `[options] <glob pattern>

Examples:
  $ npx ${name} './**/*.md'
  $ npx ${name} 'README.md'`
  )
  .action(async (globPattern, options) => {
    if (!globPattern) {
      return program.help()
    }
    await injectMarkdown({
      blockPrefix: options.blockPrefix,
      followSymbolicLinks: options.followSymbolicLinks,
      globPattern,
      quiet: options.quiet,
      useSystemEnvironment: options.systemEnvironment,
    })
  })

program.parse()
