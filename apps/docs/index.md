---
layout: home

hero:
  name: ROUTIQ
  text: Tester Handbook
  tagline: How to exercise the app, what "correct" looks like, and where to report what you find.
  actions:
    - theme: brand
      text: Start Here
      link: /start-here/01-access
    - theme: alt
      text: How to test
      link: /testing/how-to-test
    - theme: alt
      text: Glossary
      link: /glossary

features:
  - title: Start Here
    details: Get access, pick the right test account, and take the guided tour before you touch anything else.
    link: /start-here/01-access
  - title: Walkthroughs
    details: Step-by-step runs through assets, activities, approvals, and branches — follow them in order.
    link: /walkthroughs/assets/01-register-asset
  - title: Testing
    details: What we want you to look for, and how to write up a finding so it can be acted on.
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

This is the internal handbook for the ROUTIQ test team. It is written in English, it is not customer
documentation, and it is not published for search engines. If you are testing the app, this is the
only set of instructions you need to follow.

## How to use it

1. Work through **Start Here** in order: get access, sign in with the account you were assigned, then
   take the tour so the vocabulary and the navigation are familiar.
2. Run the **walkthroughs** in the order they appear in the sidebar. Later ones assume records
   created by earlier ones, so skipping ahead will leave you without the data you need.
3. Read **Testing → How to test** before you start hunting, and file every finding the way
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
