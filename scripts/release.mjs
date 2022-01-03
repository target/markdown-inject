import fs from 'fs'
import { execSync } from 'child_process'
import { Octokit } from '@octokit/rest'

const [, , action, fileName] = process.argv

const actions = {
  check: async () => {
    const {
      GITHUB_REPOSITORY,
      GH_TOKEN,
      GITHUB_SHA,
      GITHUB_RUN_ID,
    } = process.env

    const { owner, repo } =
      /^(?<owner>[^/]+)\/(?<repo>.*)$/.exec(GITHUB_REPOSITORY)?.groups || {}

    const gh = new Octokit({ auth: GH_TOKEN })

    const searchParams = {
      is: 'pr',
      repo: GITHUB_REPOSITORY,
      sha: GITHUB_SHA,
    }

    const searchQuery = Object.entries(searchParams)
      .map(([key, value]) => `${key}:${value}`)
      .join(' ')

    const {
      data: { items: prs },
    } = await gh.search.issuesAndPullRequests({
      q: searchQuery,
    })

    const skipReleaseLabel = 'skip release'
    if (
      // if any PRs attributed to this SHA have a `skip release` label
      prs.some(({ labels }) =>
        labels.find(({ name }) => name === skipReleaseLabel)
      )
    ) {
      console.log(
        `Identified matching PR with "${skipReleaseLabel}" label. Cancelling deployment.`
      )
      try {
        await gh.actions.cancelWorkflowRun({
          owner,
          repo,
          run_id: GITHUB_RUN_ID,
        })

        // Block the workflow permanently until it is shut down by GitHub
        await new Promise(() => null)
      } catch (err) {
        if (err) {
          console.log('Error while cancelling workflow run')
          return process.exit(1)
        }
      }
    }
  },
  save: async () => {
    const changelogDiff = execSync('git diff CHANGELOG.md', {
      encoding: 'utf-8',
    })

    const additionRegex = /^\+/
    const changelogAdditions = changelogDiff
      .split('\n') // evaluate each line
      .filter((line) => additionRegex.test(line)) // take only lines that begin with +
      .slice(1) // toss the first one (`+++ b/CHANGELOG.md`)
      .map((line) => line.replace(additionRegex, '')) // remove the leading `+`s
      .join('\n') // pull it all together

    fs.writeFileSync(fileName, changelogAdditions)
  },
  post: async () => {
    const { GITHUB_REPOSITORY, GH_TOKEN } = process.env

    const { owner, repo } =
      /^(?<owner>[^/]+)\/(?<repo>.*)$/.exec(GITHUB_REPOSITORY)?.groups || {}

    const releaseText = fs.readFileSync(fileName, {
      encoding: 'utf-8',
    })

    const currentTag = execSync('git tag --points-at HEAD', {
      encoding: 'utf-8',
    }).trim()

    const gh = new Octokit({ auth: GH_TOKEN })

    try {
      await gh.repos.createRelease({
        owner,
        repo,
        tag_name: currentTag,
        name: currentTag.replace(/^v/i, ''),
        body: releaseText,
      })
    } catch {
      console.log('Error while creating release')
      return process.exit(1)
    }
  },
}

if (actions[action]) {
  await actions[action]()
} else {
  throw new Error(
    `Unrecognized action "${action}". Valid actions:\n${Object.keys(actions)
      .map((t) => `- ${t}`)
      .join('\n')}`
  )
}
