### Local Development

This project builds with node version:

<!-- CODEBLOCK_START {"value": ".nvmrc", "hideValue": true} -->
<!-- prettier-ignore -->
~~~~~~~~~~bash
v16.19.0
~~~~~~~~~~

<!-- CODEBLOCK_END -->

After cloning the repository, install dependencies and build the project:

```
npm ci
```

Build the library and watch for changes:

```
npm start
```

Link your local copy:

```
npm link
```

`markdown-inject` commands in any terminal will now run using your local copy.

### Validation

This app ships with a local suite of [jest](https://jestjs.io/) tests, [eslint](https://eslint.org/) + [prettier](https://prettier.io/) configurations for code consistency and formatting, and [TypeScript](https://www.typescriptlang.org/) type validation. Each of these features can be validated using...

```bash
npm test
npm run lint
npm run build
```

A `validate` utility script chains these calls together, and is called on every commit.

```bash
npm run validate
```
