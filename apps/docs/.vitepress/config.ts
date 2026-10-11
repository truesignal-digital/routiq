import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    base: '/team-docs-k4v9w2/',
    lang: 'en-US',
    title: 'ROUTIQ Tester Handbook',
    description: 'Internal handbook for the ROUTIQ test team.',
    // Operator-only source files are excluded. Public test credentials live on
    // start-here/01-access.md; CREDENTIALS.md is only its deployment-side mirror.
    srcExclude: ['DEPLOY.md', 'CREDENTIALS.md'],
    head: [['meta', { name: 'robots', content: 'noindex, nofollow' }]],
    themeConfig: {
      search: { provider: 'local' },
      outline: [2, 3],
      sidebar: [
        {
          text: 'Start here',
          items: [
            { text: 'Access', link: '/start-here/01-access' },
            { text: 'Accounts and roles', link: '/start-here/02-accounts' },
            { text: 'Tour of the app', link: '/start-here/03-tour' },
            { text: 'Company flow', link: '/start-here/04-company-flow' },
          ],
        },
        {
          text: 'October 2026 release',
          items: [{ text: "What's new", link: '/release-2026-10/' }],
        },
        {
          text: 'Daily work',
          items: [
            { text: 'Dashboard', link: '/daily-work/dashboard' },
            {
              text: 'Trucks',
              collapsed: false,
              items: [
                { text: 'Overview and list', link: '/daily-work/trucks/01-overview-and-list' },
                { text: 'Register a truck', link: '/daily-work/trucks/02-register-a-truck' },
                { text: 'The truck page', link: '/daily-work/trucks/03-truck-page' },
              ],
            },
            {
              text: 'Trips',
              collapsed: false,
              items: [
                { text: 'Overview', link: '/daily-work/trips/01-overview' },
                { text: 'Record a sheet', link: '/daily-work/trips/02-record-a-sheet' },
                { text: 'Expenses and revenue', link: '/daily-work/trips/03-expenses-and-revenue' },
                { text: 'Close and reopen', link: '/daily-work/trips/04-close-and-reopen' },
              ],
            },
            {
              text: 'Maintenance',
              collapsed: false,
              items: [
                { text: 'Overview', link: '/daily-work/maintenance/01-overview' },
                { text: 'Report a problem', link: '/daily-work/maintenance/02-report-a-problem' },
                { text: 'Work orders', link: '/daily-work/maintenance/03-work-orders' },
              ],
            },
            {
              text: 'Money',
              collapsed: false,
              items: [
                { text: 'Overview', link: '/daily-work/money/01-overview' },
                { text: 'Entries and recording', link: '/daily-work/money/02-entries-and-recording' },
                { text: 'Approve and reject', link: '/daily-work/money/03-approve-and-reject' },
                { text: 'Accounting months', link: '/daily-work/money/04-accounting-months' },
              ],
            },
          ],
        },
        {
          text: 'Company',
          items: [
            { text: 'People and users', link: '/company/people-and-users' },
            { text: 'Branches', link: '/company/branches' },
            { text: 'Company settings', link: '/company/company-settings' },
          ],
        },
        {
          text: 'Presets',
          items: [{ text: 'Passenger company', link: '/presets/passenger-company' }],
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
