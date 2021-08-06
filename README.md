# markdown-inject

Add file or command output to markdown documents.

<!-- GIF -->

## Installation

`markdown-inject` is written in TypeScript and distributed as a node module on the npm ecosystem. It exposes a bin executable, making it a command line offering.

Download and invoke in one command:

```
npx markdown-inject
```

Local npm installation:

```
npm install markdown-inject --save-dev
```

or with Yarn:

```
yarn add markdown-inject --dev
```

Optionally, wire up `markdown-inject` to a git pre-commit hook tool like [husky](https://github.com/typicode/husky) to automatically update markdown injection as part of your workflow.

## Usage

<!--
  CODEBLOCK_START
  {
    "type": "command",
    "value": "npm run --silent markdown-inject -- --help",
    "hideValue": true
  }
-->
<!-- prettier-ignore -->
~~~~~~~~~~bash
Usage: markdown-inject [options] <glob pattern>

Examples:
  $ npx markdown-inject './**/*.md'
  $ npx markdown-inject 'README.md'

Add file or command output to markdown documents.

Options:
  -v, --version                   output the version number
  -b, --block-prefix <prefix>     specifies the prefix for START and END HTML
                                  comment blocks (default: "CODEBLOCK")
  -n, --no-follow-symbolic-links  prevents globs from following symlinks
  -q, --quiet                     emits no console log statements (default:
                                  false)
  -h, --help                      display help for command
~~~~~~~~~~

<!-- CODEBLOCK_END -->

`markdown-inject` expands a given glob for markdown files. Then it discovers the below `CODEBLOCK` HTML comments within each markdown file, performs the appropriate action (in this case, reading another local file), and writes content back into the markdown file:

<!-- CODEBLOCK_START_EXAMPLE1 {"ignore": true} -->

```
<!-- CODEBLOCK_START {"value": ".nvmrc"} -->
<!-- CODEBLOCK_END -->
```

<!-- CODEBLOCK_END_EXAMPLE1 -->

```
<!-- CODEBLOCK_START {"value": ".nvmrc"} -->
<!-- prettier-ignore -->
~~~~~~~~~~bash
File: .nvmrc

v14.17.4
~~~~~~~~~~

<!-- CODEBLOCK_END -->
```

Output is written between the CODEBLOCK_START and CODEBLOCK_END comments. Output includes:

- A prettier ignore comment introducing the output so that prettier does not further alter existing code.
- A markdown codeblock is opened with the language specified via configuration.
- The type:value line is included by default, labeling the output.
- The command or file output.

Executing commands follows a similar syntax:

<!-- CODEBLOCK_START_EXAMPLE2 {"ignore": true} -->

```
<!-- CODEBLOCK_START {"value": "echo hello world", "type": "command"} -->
<!-- prettier-ignore -->
~~~~~~~~~~bash
$ echo hello world

hello world
~~~~~~~~~~
<!-- CODEBLOCK_END -->
```

<!-- CODEBLOCK_END_EXAMPLE2 -->

You can hide the type:value comment from the generated output too:

<!-- CODEBLOCK_START_EXAMPLE3 {"ignore": true} -->

```
<!-- CODEBLOCK_START {"value": "echo hello world", "type": "command", "hideValue": false} -->
<!-- prettier-ignore -->
~~~~~~~~~~bash
$ echo hello world

hello world
~~~~~~~~~~

<!-- CODEBLOCK_END -->
```

<!-- CODEBLOCK_END_EXAMPLE3 -->

## Codeblock Configuration

The `CODEBLOCK_START` HTML comment config block has the following properties:

| Name        | Type                  | Required | Default                                   | Description                                                    |
| ----------- | --------------------- | -------- | ----------------------------------------- | -------------------------------------------------------------- |
| `value`     | `string`              | `true`   |                                           | Command to execute or file to retrieve                         |
| `type`      | `'command' \| 'file'` | `false`  | `'file'`                                  | Type of execution.                                             |
| `language`  | `string`              | `false`  | `command`: `bash`, `file`: File extension | Syntax highlighting language                                   |
| `hideValue` | `boolean`             | `false`  | `false`                                   | Do not display `File: foo.js` or `$ npx foo` on the first line |
| `trim`      | `boolean`             | `false`  | `true`                                    | Trim whitespace from the ends of file or command output.       |

## Contributing

See [CONTRIBUTING.md](/CONTRIBUTING.md) for more information.

## Similar Projects

- [embedme](https://github.com/zakhenry/embedme) - embed source files into markdown code blocks
- [mdsh](https://github.com/zimbatm/mdsh) - a similar tool but for the Rust ecosystem
