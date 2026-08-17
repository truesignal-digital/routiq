---
layout: home

hero:
  name: ROUTIQ
  text: Tester Handbook
  tagline: How to exercise the app, what "correct" looks like, and where to report what you find.
  actions:
    - theme: brand
      text: Open test accounts
      link: /start-here/01-access
    - theme: alt
      text: See company flow
      link: /start-here/04-company-flow
    - theme: alt
      text: Glossary
      link: /glossary

features:
  - title: Start Here
    details: Open the public demo, copy a workspace username and six-digit PIN, and learn what that company job owns.
    link: /start-here/01-access
  - title: Walkthroughs
    details: Hand work from Admin to branch operations, Maintenance, Finance, and Executive review.
    link: /walkthroughs/assets/01-register-asset
  - title: Testing
    details: Run the complete two-branch company scenario and test every role and authorization boundary.
    link: /testing/how-to-test
---

## What ROUTIQ is

ROUTIQ is an asset lifecycle and profitability platform for asset-operating businesses — businesses
whose profit centers are expensive operated assets. In the pilot that means Cameroonian transport
operators: trucking fleets and passenger transport operators. The app tracks each asset through its
life, records the activities it performs, captures the costs and revenue those activities generate,
and reports on what each asset actually earns. It is built for French-first users on low-end Android
phones over intermittent connectivity, so capture works offline and syncs later.

## Who this site is for

This is the handbook for the ROUTIQ test team. It is written in English, it is not customer
documentation, and search engines are instructed not to index it. The application and the
credentials listed here are public, disposable test infrastructure with no real users.

## How to use it

1. Work through **Start Here** in order: choose a real company job, take the app tour, and understand
   how work moves between accounts.
2. Run the **walkthroughs** in the order they appear in the sidebar. Sign out at each handoff instead
   of using Admin for every task.
3. Follow **Testing → Run the company test flow**, and file every finding the way
   **Reporting bugs** describes. A finding that nobody can reproduce is a finding we cannot fix.

::: warning UI labels change from workspace to workspace
ROUTIQ shows different words to different customers. Each workspace enables one or more **template
presets**, and the preset supplies the vocabulary: a trucking workspace says **Truck** and **Trip**.
A passenger transport workspace says **Vehicle** (and in French, **Véhicule** and **Voyage**, whereas
trucking French says **Camion** and **Trajet**). Same screens, same data, different labels.

**Every walkthrough on this site is written using the trucking workspace's labels.** If your test
workspace is a passenger one, the buttons and headings will read differently from the steps —
translate as you go using the [Glossary](/glossary), which maps the terms side by side. A label that
differs from this handbook is not automatically a bug; a label that does not match *either* preset
is.
:::
