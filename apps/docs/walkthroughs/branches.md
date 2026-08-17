# Branches & multi-branch administration

Guided walkthroughs for the branch module are still being written. Until they land, the notes below tell you what the module covers so you can explore it yourself — everything here is reachable today as **Admin**, under **More → Branches** and **More → Users**, plus the branch switcher at the top of the app shell.

What the module covers:

- **Creating a branch** — **More → Branches → New branch**, with a **Code** (2–8 uppercase letters or digits, immutable, and it appears inside record numbers), a **Name** and a **Time zone**.
- **Renaming and deactivating** — a branch is renamed but never re-coded, and deactivated but never deleted. A deactivated branch keeps its history and accepts no new operations; the workspace must always keep at least one active branch.
- **User branch scope** — **More → Users** assigns each user either **All branches** or a named subset. That scope is the server-derived authorization boundary: a branch-scoped user's reads and commands can never reach outside it.
- **The ambient branch** — the switcher in the shell header (**Current branch**, or **All my branches**) is a viewing lens *within* your scope, not an access boundary. It narrows lists and their filters; it never changes what a command may reference, and pending-work badges always count your whole scope.
- **Cross-branch transfer** — moving a truck to another branch is the one asset action that needs an approval, and the seeded rule names the **Finance approver** as the role that can complete it. See [assets lesson 03](/walkthroughs/assets/03-lifecycle) for the walkthrough that already exists.
- **Branch-scoped queues and lists** — the approvals queue, the entries list, the assets list and the trips list all respect scope, and each says out loud when it is showing you less than everything (*Filtered: …*, *+N pending in other branches*).
