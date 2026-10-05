# Roles and people vs users: research for ROUTIQ

Date: 2026-09-27. Scope: how fleet products define roles, how they model people who don't log in, and which job titles Cameroonian transport companies actually use. Recommendation at the end.

## Answer first

- Use **6 fixed roles, plus 1 optional**: Administrateur, Gestionnaire de flotte, Comptable, Mécanicien, Chauffeur, Lecteur. The optional one is Agent de saisie. Every product surveyed ships roughly this set under different names.
- Keep **role separate from scope**. "Chef d'agence" is a Gestionnaire de flotte limited to one branch. It is not a separate role. Samsara (roles + tags), Fleetio (roles + record sets) and Whip Around (Team Manager) all do this.
- Keep **role separate from job title**. The job title ("poste": Chef de parc, DG, Caissière) is free text on the person and can say anything. The role is the fixed list people are trained on.
- **People and users**: keep one "Personnes" list. App access is an optional thing a person can have. Don't run two lists (the Samsara pattern), and don't make every person a login (it forces emails or phones and licences on people who never use the app). Fleetio and Odoo both work this way.

## 1. How fleet products define roles

### Fleetio
- User types: **Account Owner**, **Administrator**, **Regular User**. Regular users get a customizable **Role**. Each module is set to full, some (create/view/edit/delete) or none. Plan limits cap the number of roles (4 / 15 / 30). Fleetio ships no named default roles, so every customer builds its own. [F2]
- **Record Sets** decide which vehicles, contacts and part locations a user can see. That is scope, kept separate from the role. [F1][F2]
- **Contacts vs users:** a contact is a record for anyone you employ or deal with, and it has no login. Any contact can become a user at any time. You select it in the contact list and choose "Enable User Access". This needs an email, a login method, a role and record sets. [F3][F4]
- Contacts carry **classifications** that can be combined. **Operator** means the contact can be assigned to vehicles. **Technician** means it can appear on work-order labor lines. **Employee** only marks the person as internal. [F4]
- Drivers who use the Fleetio Go app are ordinary Regular Users. Their role includes "Submit Inspections", and their record set gives edit access to the vehicle. [F5]
- **Vendors** (garages, fuel stations) are a separate entity from contacts. [F1]

### Samsara
- Default roles: **Full Admin** (everything, including other users' roles and billing), **Standard Admin** (everything except billing, invoicing and licensing), **Read-only Admin** (view only), and **Maintenance** (edit maintenance features). A user can hold several roles, each limited to a **tag** such as a region. Admins can only invite others at or below their own level. [S1][S2]
- **Drivers are a separate account type**. The fleet manager creates a driver profile with a username and password for the Samsara Driver App. Drivers log in with Fleet ID + username + password, and only the fleet manager can reset those. Samsara support cannot. [S3][S4]
- So one human who is both dispatcher and occasional driver has two identities in Samsara.

### Motive (formerly KeepTruckin)
- **Fleet Admin**: full dashboard and Admin panel, manages users, vehicles and company settings. **Fleet Manager**: limited by default, no Admin-panel changes, and admins can widen it per feature or per group. **Dispatcher**: a typical custom role that sees live locations, dispatches and messages drivers. Custom roles are built from permission areas: Admin, Compliance, Safety, Maintenance, Workforce, and Motive Card (spend). [M1]
- Drivers are managed as a separate "Drivers" list, apart from "Fleet Users". [M2][M3]
- The help-center pages returned 403. These facts come from search-result excerpts of the cited pages, not from full reads.

### Whip Around
This is the closest match to ROUTIQ's shape: five fixed roles.
- **Admin**: everything, including settings and billing.
- **Manager**: sees and edits everything except account settings, billing, forms and user profiles.
- **Team Manager**: a Manager limited to certain teams.
- **Mechanic**: Maintenance tab only (defects, work orders).
- **Driver**: mobile app only, inspections of assigned assets. [W1]
- An Admin or Manager who also does inspections gets a driver profile added to their user profile. So a user can also be a driver: one identity with an extra capability. [W1]

### Odoo Fleet
- Two access groups: **Officer: Manage all vehicles** and **Administrator**. Record rules also let ordinary users see only their own vehicle, contracts, services and odometer. Source: `addons/fleet/security/fleet_security.xml` [O1]. An Odoo PR from September 2026 notes that Officers were wrongly limited to their own vehicles in stable versions. The fix is only in 19.0. [O2]
- The vehicle's **Driver** field points to a **contact (`res.partner`)**, not to an employee or user. Source: `fleet_vehicle.py`, `driver_id = Many2one('res.partner')`. [O3]

### Wialon (widely used by GPS resellers in Africa)
- **Drivers are objects inside a "resource"**, not users. A user needs the "Create, edit and delete drivers" access right on that resource to assign drivers to units. [WL1][WL2]

### Maximo / SAP
Not researched. Their security-group models are built for enterprise maintenance and seemed too heavy for a 5–7 role target.

### What they share

| Tier | Fleetio | Samsara | Motive | Whip Around | Odoo |
|---|---|---|---|---|---|
| Owner / admin | Account Owner, Administrator | Full Admin | Fleet Admin | Admin | Administrator |
| Runs operations, no billing or users | (custom role) | Standard Admin | Fleet Manager | Manager | Officer |
| Same, limited to part of the fleet | Record Sets | Tags | Groups | Team Manager | – |
| Maintenance | Technician (contact) + role | Maintenance | Maintenance permission | Mechanic | – |
| Driver (mobile) | Regular User + Operator | Driver account | Driver | Driver | own-vehicle rule |
| Read-only | (custom) | Read-only Admin | (custom) | – | – |
| Money | module permissions | billing excluded from Standard | Motive Card permissions | billing = Admin | – |

Three things are standard across all of them:
- Owner/admin at the top.
- An operations manager who can do everything except users and billing.
- Mechanic and driver as narrow roles.

Scope (region, team, record set) sits on top of the role. It is never a new role.

## 2. Person vs user

| Product | Person without login | Login | How a driver gets a login later |
|---|---|---|---|
| Fleetio | Contact (Operator / Technician / Employee) | the same contact with user access turned on | "Enable User Access" on the existing contact. History stays. Needs an email. [F3][F4] |
| Odoo | `hr.employee` or `res.partner` | `res.users`, linked from the employee's "Related User" field | Create a user from the employee form. Users need a paid licence; employees don't. [O4][O5] |
| Whip Around | – | user profile, with an optional driver profile | Add a driver profile to the existing user. [W1] |
| Samsara | – | admin user and driver account are separate | The same human ends up with two accounts. [S3] |
| Wialon | driver object in a resource | user | Unrelated objects. [WL1] |

**Two lists (Samsara, Wialon).**
- Pro: the driver app and the office dashboard stay simple and separate.
- Con: when a driver is promoted to chef de parc, or a manager drives, you get duplicate identities. Reports split. Audit trails attribute the same person twice.

**Everyone is a user (a single table with a login).**
- Pro: one concept.
- Con: every mechanic, casual driver and payee needs a login identifier and possibly a licence. "Users" count rises. Disabling someone's access risks hiding their history.

**One person, optional access (Fleetio, Odoo).**
- Pro: records (trips, fuel, labor, payments) point at the person, who is stable. Access can be granted or revoked without touching history. Promotion is just a role change.
- Con: a second concept (access/account) sits behind the person. The UI has to hide it well.

**Two gaps specific to Cameroon.**
- Fleetio requires an **email** to enable access. Many Cameroonian drivers and mechanics have a phone number but no email they use. Samsara uses **username + fleet ID** that the manager hands out. For ROUTIQ, a phone number, or a manager-issued username/PIN, fits better than email. This is an inference from the user profile ("low-end Android") and was not researched.
- External **payees** that are businesses (garages, fuel stations, parts shops) are **vendors** in Fleetio, separate from contacts. [F1] Only individual payees, such as a freelance mechanic or a loader paid per trip, belong in People.

## 3. Job titles used in Cameroonian transport

Evidence found, with sources:

- **Chauffeur poids lourds – semi-remorques**, **Chauffeur véhicule léger**, **Mécaniciens**, **Superviseur mécanique**, **Pneumaticiens**, **Tôliers**, **Radiateuriste**, **Responsable du suivi vidange et pneumatique**, **Agent tracking**, **Assistant logisticien**, **Chef comptable**, **Comptable caisse siège**, **Chargé des moyens généraux**. All from one Cameroonian fuel-logistics fleet (PSL Petro Services et Logistiques) on MinaJobs. [J1]
- **Chef de garage** (Yaoundé, 2026). The job coordinates mechanics and technicians, manages the fleet's mileage and fuel, handles spare parts and does diagnostics on light vehicles, heavy trucks and handling equipment. [J2]
- **Chef de parc automobile** and **Responsable parc automobile** are live categories on emploi.cm. **Réceptionnaire de parc automobile** also appears: it coordinates vehicle movements, maintenance follow-up, and the link between management, drivers and workshops. [J3][J4]
- **Gestionnaire de la flotte automobile** and **Responsable d'exploitation transport routier de marchandises** appear in Cameroonian CVs and postings on emploi.cm. Candidates report running fleets of more than 100 trucks (Beiben, Iveco, JAC, Mercedes). [J5]
- **Chauffeur d'agence** (MinaJobs). [J6]
- **Chef d'agence** is common on MinaJobs, but mostly in banking, microfinance and travel agencies. No passenger-transport posting was found. [J7]
- Bus companies: Touristique Express (about 700 staff, 22 stations) uses **Direction générale**, **agences**, **gares**, **chauffeurs** and **hôtesses** on its own site. [J8] General Express Voyage describes agencies across all ten regions. [J9]
- WageIndicator Cameroon groups **caissiers et billettistes** as one occupation. [J10]

Not confirmed from sources: **Convoyeur**, **Chef d'atelier** and **Directeur/Chef d'agence** in a bus-company posting. The terms are plausible, but searches returned no Cameroonian transport postings (emploi.cm and optioncarriere.cm blocked automated fetches). Check these with the two pilot tenants before printing them in training material.

How job titles map to roles (job title is free text on the person; role is the fixed list):

| Job title (poste) | Role |
|---|---|
| DG, gérant, propriétaire | Administrateur |
| Directeur d'exploitation, Responsable d'exploitation, Chef de parc, Gestionnaire de flotte, Responsable parc automobile, Chargé des moyens généraux (internal fleets) | Gestionnaire de flotte, all branches |
| Chef d'agence, chef de gare, responsable de site | Gestionnaire de flotte, one branch |
| Comptable, Chef comptable, DAF, Caissier(ère) at head office | Comptable |
| Chef de garage / chef d'atelier, Superviseur mécanique, Mécanicien, Pneumaticien, Magasinier | Mécanicien |
| Chauffeur PL / VL, Chauffeur d'agence | Chauffeur |
| Hôtesse, guichetier, billettiste, caissier(ère) d'agence, agent tracking | Agent de saisie (optional), or no access |
| Auditor, shareholder, partner, bank | Lecteur |

## 4. Recommendation

### Roles (fixed, 6 + 1 optional)

| FR | EN | Can do | Industry match |
|---|---|---|---|
| **Administrateur** | Administrator | Everything: people and access, branches, settings, period locks | Fleetio Admin, Samsara Full Admin, Motive Fleet Admin, Whip Around Admin |
| **Gestionnaire de flotte** | Fleet manager | All operations in its scope: vehicles, trips, assignments, maintenance, operational approvals. No access management, no settings | Samsara Standard Admin, Motive Fleet Manager, Whip Around Manager / Team Manager, Odoo Officer |
| **Comptable** | Accountant | Costs, payments, revenue, financial approvals and reversals, period lock, financial reports. Read-only on operations | Samsara keeps finance out of Standard Admin; Motive Card permissions |
| **Mécanicien** | Mechanic | Work orders, labor, parts used, defects on vehicles in scope | Whip Around Mechanic, Samsara Maintenance, Fleetio Technician |
| **Chauffeur** | Driver | Mobile capture on **assigned** vehicles: inspections, fuel, meter, trip facts, photos. Sees only their own | Driver in Whip Around, Samsara and Motive; Odoo "own vehicle" rule |
| **Lecteur** | Viewer | Read everything in scope, change nothing | Samsara Read-only Admin |
| *Agent de saisie* (optional) | Clerk | Capture records (receipts, trip revenue at the counter) for any vehicle in scope. Approves nothing | none of the surveyed products; covers hôtesse and caissier(ère) d'agence |

Rules that keep the list stable:
1. **Branch scope is separate from role.** Each access is role + scope ("toutes les agences" or one branch). Show it as "Gestionnaire de flotte · Agence Bafoussam". Don't add a "Chef d'agence" role. That is a job title.
2. **One role per access.** If the pilots need combinations, allow extra branch-scoped accesses rather than stacking roles (Samsara stacks roles; it is flexible but harder to train).
3. **Admins can only grant roles at or below their own**, as in Samsara. [S2]
4. Approvals that ARCHITECTURE.md §5.1 gives to the "finance approver" map to Comptable. Operational approvals map to Gestionnaire de flotte.

### People vs users: one list, access is optional

- **Data model:** a single **Personne** is the identity every record points to (driver on a trip, mechanic on labor, payee, approver). **App access** is optional and attached to the person: role + branch scope + login identifier + active/revoked.
- **Capability flags on the person**, as in Fleetio's Operator/Technician classifications: "peut conduire" (can be assigned to vehicles) and "peut intervenir en atelier" (can appear on labor). These are separate from app access. A Gestionnaire who sometimes drives just has "peut conduire" ticked. A mechanic with no phone can still be named on work orders.
- **UI:** one **Personnes / People** screen. Each row shows name, job title and phone, plus an access badge ("Accès : Chauffeur" / "Sans accès"). The person page has a **"Donner l'accès à l'application"** button that asks for role, branch and phone (or username). **"Retirer l'accès"** removes access but keeps the person and all history. There is no separate "Users" screen.
- **When a driver needs to log in later:** open the existing person, then choose Give access. No new record, so their history stays attached. This is Fleetio's path, without the email requirement.
- **Payees:** businesses are **Fournisseurs** (vendors), a separate list, as in Fleetio. Only individuals go in Personnes.
- Worth checking: the working tree has an untracked migration `apps/api/drizzle/0025_person_membership_constraints.sql`, so a person/membership split may already be under way. I did not read it.

## Sources

- [F1] Fleetio, Contacts, Users & Vendors: https://help.fleetio.com/en_US/contacts-users-vendors
- [F2] Fleetio, User Roles & Permissions: https://help.fleetio.com/manage-account-settings-permissions/user-roles-permissions
- [F3] Fleetio, Contacts vs. Users Explained: https://help.fleetio.com/contacts-users-vendors/contacts-vs-users-explained
- [F4] Fleetio, Contacts Overview: https://help.fleetio.com/en_US/contacts-overview
- [F5] Fleetio, Inspections Overview / Fleetio Go for Operators: https://help.fleetio.com/inspections/inspections-overview , https://help.fleetio.com/en_US/fleetio-go-for-operators
- [S1] Samsara, Administrative Roles: https://kb.samsara.com/hc/en-us/articles/4411870638733-Administrative-Roles
- [S2] Samsara, Manage Administrators / Set up Users with Roles and Tags: https://kb.samsara.com/hc/en-us/articles/4411273129741-Manage-Administrators , https://samsara-industrial-user-manual.scrollhelp.site/site/Set-up-Users-with-Roles-and-Tags.209912001.html
- [S3] Samsara, Manage Driver Accounts: https://kb.samsara.com/hc/en-us/articles/4402804484621-Manage-Driver-Accounts
- [S4] Samsara, Troubleshoot Driver Login Issues: https://kb.samsara.com/hc/en-us/articles/32408537294605-Troubleshoot-Driver-Login-Issues
- [M1] Motive, Roles and Permissions: https://helpcenter.gomotive.com/hc/en-us/articles/30898429926685-Roles-and-Permissions
- [M2] Motive, Fleet Users: https://helpcenter.gomotive.com/hc/en-us/articles/31185986332701-Fleet-Users
- [M3] Motive, Create and Edit Drivers: https://helpcenter.gomotive.com/hc/en-us/articles/30893446834333-Create-and-Edit-Drivers
- [W1] Whip Around, Users & Permissions Overview: https://help.whiparound.com/en/articles/780147-users-permissions-overview
- [O1] Odoo 18 source, fleet security groups: https://github.com/odoo/odoo/blob/18.0/addons/fleet/security/fleet_security.xml
- [O2] Odoo PR #266262, fleet officer access rights: https://github.com/odoo/odoo/pull/266262
- [O3] Odoo 18 source, fleet.vehicle driver_id: https://github.com/odoo/odoo/blob/18.0/addons/fleet/models/fleet_vehicle.py
- [O4] Odoo docs, New employees: https://www.odoo.com/documentation/19.0/applications/hr/employees/new_employee.html
- [O5] Odoo forum, Do all employees need to be users?: https://www.odoo.com/forum/help-1/do-all-employees-need-to-be-users-283993
- [WL1] Wialon, Assigning drivers: https://help.wialon.com/en/wialon-local/2104/user-guide/monitoring-system/drivers/assigning-drivers
- [WL2] Wialon, Resource and account access rights: https://help.wialon.com/en/wialon-hosting/user-guide/management-system/access-rights/resource-and-account-access-rights
- [J1] MinaJobs, PSL Petro Services et Logistiques postings: https://cameroun.minajobs.net/stages-emplois-a/psl-petro-services-et-logistiques-sarl-cameroun/4853
- [J2] Chef de Garage, SAFVIS (Yaoundé, 2026): https://infosconcourseducation.com/offre-demploi-2026-chef-de-garage-safvis/
- [J3] emploi.cm, Chef de Parc Automobile: https://www.emploi.cm/emploi-chef-parc-automobile
- [J4] emploi.cm, Responsable Parc Automobile: https://www.emploi.cm/recrutement-responsable-parc-automobile
- [J5] emploi.cm, transport/logistics CV profiles: https://www.emploi.cm/recrutement-cameroun-cv/12887 , https://www.emploi.cm/recherche-base-donnees-cv/transport%20routier%20fret
- [J6] MinaJobs, Chauffeur d'agence: https://cameroun.minajobs.net/emplois-stage-recrutement/25763/avis-de-recrutement-chauffeur-dagence-at-une-entreprise-de-la-place
- [J7] MinaJobs, Chef d'agence (MEN Group / MEN Travel): https://cameroun.minajobs.net/stages-emplois-a/men-group-sa-cameroun/993
- [J8] Touristique Express SA: https://www.touristique.cm/
- [J9] General Express Voyage listing: https://afrique-originale.com/listing/cameroun/general-express-voyage/
- [J10] WageIndicator Cameroun, Caissiers et billettistes: https://wageindicator.org/fr-cm/travail-au-cameroun/travail-et-revenus/caissiers-et-billettistes/

Access notes: Samsara, Motive and emploi.cm returned HTTP 403 to automated fetches. Facts from those sites come from search-result excerpts of the cited pages. Fleetio, Whip Around, Odoo source, MinaJobs (PSL) and Touristique Express were read directly.
