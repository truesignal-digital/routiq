import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    base: '/team-docs-k4v9w2/',
    lang: 'en-US',
    title: 'ROUTIQ Tester Handbook',
    description: 'Internal handbook for the ROUTIQ test team.',
    // Operator-only files are not handbook pages and must never be published.
    srcExclude: ['DEPLOY.md', 'CREDENTIALS.md'],
    head: [['meta', { name: 'robots', content: 'noindex, nofollow' }]],
    themeConfig: {
      search: { provider: 'local' },
      outline: [2, 3],
      sidebar: [
        {
          text: 'Start Here',
          items: [
            { text: 'Access', link: '/start-here/01-access' },
            { text: 'Accounts', link: '/start-here/02-accounts' },
            { text: 'Tour', link: '/start-here/03-tour' },
          ],
        },
        {
          text: 'Walkthroughs — Assets',
          items: [
            { text: 'Register an asset', link: '/walkthroughs/assets/01-register-asset' },
            { text: 'Edit and correct', link: '/walkthroughs/assets/02-edit-and-correct' },
            { text: 'Lifecycle', link: '/walkthroughs/assets/03-lifecycle' },
          ],
        },
        {
          text: 'Walkthroughs — Activities',
          items: [
            { text: 'Create a trip', link: '/walkthroughs/activities/01-create-trip' },
            { text: 'Record costs', link: '/walkthroughs/activities/02-record-costs' },
            { text: 'Close a trip', link: '/walkthroughs/activities/03-close-trip' },
          ],
        },
        {
          text: 'Walkthroughs — Approvals',
          items: [
            { text: 'Approve and reject', link: '/walkthroughs/approvals/01-approve-and-reject' },
          ],
        },
        {
          text: 'Walkthroughs — More',
          items: [
            { text: 'Passenger overlay', link: '/walkthroughs/passenger-overlay' },
            { text: 'Branches', link: '/walkthroughs/branches' },
          ],
        },
        {
          text: 'Testing',
          items: [
            { text: 'How to test', link: '/testing/how-to-test' },
            { text: 'Reporting bugs', link: '/testing/reporting-bugs' },
          ],
        },
        {
          text: 'Glossary',
          items: [{ text: 'Glossary', link: '/glossary' }],
        },
      ],
    },
  }),
)
