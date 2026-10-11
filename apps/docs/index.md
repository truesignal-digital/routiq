---
layout: home

hero:
  name: ROUTIQ
  text: Tester Handbook
  tagline: How to test the app, what "correct" looks like, and where to report what you find.
  actions:
    - theme: brand
      text: Open test accounts
      link: /start-here/01-access
    - theme: alt
      text: What's new in October 2026
      link: /release-2026-10/
    - theme: alt
      text: Glossary
      link: /glossary

features:
  - title: Start here
    details: Sign in, pick the right role, and learn how the screens are laid out.
    link: /start-here/01-access
  - title: Daily work
    details: The Dashboard, then Trucks, Trips, Maintenance and Money, one lesson at a time.
    link: /daily-work/dashboard
  - title: Testing
    details: Run the company story across roles, then report each finding the same way.
    link: /testing/how-to-test
---

## What ROUTIQ is

ROUTIQ helps a transport company in Cameroon run its fleet and see where the money goes. Each truck has its own page: its trips, its expenses, its problems and repairs, its papers. The Dashboard answers three questions: are we making money, what changed, and what needs you today.

The first customers are companies that run their own fleet. A trucking company and a passenger (bus) company are also set up as test companies. The app is French first, with English as the second language, and it is built for cheap Android phones on weak connections.

## Who this site is for

This is the handbook for the ROUTIQ test team. It is in English. It is not customer documentation, and search engines are told not to index it. The test companies and their accounts are public and disposable. There are no real users in them.

## How to use it

1. Read **Start here** in order. It gives you the accounts, the six roles, and a tour of the screens.
2. Read [What's new in October 2026](/release-2026-10/) if you tested ROUTIQ before. Most screens changed.
3. Work through **Daily work** in sidebar order. Sign in as the role each lesson names. Do not use the Director for everything.
4. Run [How to test](/testing/how-to-test), and report every finding as [Reporting bugs](/testing/reporting-bugs) describes. A finding nobody can reproduce is a finding we cannot fix.

::: warning Labels change from company to company
ROUTIQ shows different words to different companies. A trucking company sees **Trucks**. A passenger company sees **Vehicles**. Same screens, same data, different words.

**Every lesson on this site uses the trucking company's words** (workspace `transports-ngwa`). In the passenger company, translate as you go with [Passenger company](/presets/passenger-company) and the [Glossary](/glossary). A label that differs from this handbook is not automatically a bug. A label that matches neither company is.
:::
