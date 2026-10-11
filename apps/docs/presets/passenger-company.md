# Passenger company

**Goal** — Check that the passenger company, Littoral Voyages, uses its own words on every screen while working exactly like the trucking company.

**Log in as** — the Director (`josiane`), then the Driver (`eric`), in workspace `littoral-voyages`. PINs are on [Access](/start-here/01-access).

Each company starts from a **preset**: trucking, passenger (bus) or internal fleet. The preset picks the default modules and the words on screen. The screens and the rules are the same; only the words change. Testers cannot change a company's preset or modules: the vendor sets them.

## The words that change

| Trucking (`transports-ngwa`) | Passenger (`littoral-voyages`) | French, trucking / passenger |
| --- | --- | --- |
| Trucks | Vehicles | Camions / Véhicules |
| Truck | Vehicle | Camion / Véhicule |
| Register a truck | Register a vehicle | |
| Trucks that can drive | Vehicles that can drive | |
| Profit by truck | Profit by vehicle | |
| Trucks in service | Vehicles in service | Camions en service / Véhicules en service |
| Primary truck | Primary vehicle | |
| Trips | Trips | Trajets / Voyages |

In English both companies say **Trips**. In French the trucking company says **Trajets** and the passenger company says **Voyages**.

## Steps

1. Sign in as `josiane` in `littoral-voyages` and switch to English.

> ✅ Expected: the **Dashboard** with tabs **Overview**, **To do**, **Profit by vehicle** and **Profit by branch**. The tile reads **Vehicles that can drive**. The sidebar reads **Vehicles**, not Trucks.

![Littoral Voyages: the Dashboard with Profit by vehicle and Vehicles that can drive](/presets/passenger-dashboard.png)

2. Read the summary.

> ✅ Expected: this company has revenue in October, so the summary gives a result, for example *So far in October: a profit of 227 800 FCFA on 384 000 FCFA revenue. It is the first month in ROUTIQ, so there is nothing to compare it with yet.* with the badge **First month**.

3. Click **Vehicles**.

> ✅ Expected: the page **Vehicles**, *Track every vehicle from registration through retirement.*, the button **Register a vehicle**, and tabs **Overview** · **Vehicles** · **Documents**. The Overview has the same tiles and **Fleet board** as Trucks, with the vehicles LV-CAR-01, LV-COA-02 and LV-MIN-03.

![Vehicles Overview in the passenger company](/presets/passenger-vehicles-overview.png)

4. Click **Trips**, then the **Trips** tab.

> ✅ Expected: the column **Primary vehicle** and the filter **Vehicle**. Trip types are passenger ones, for example **Scheduled journey**.

![Trips in the passenger company: Primary vehicle and Scheduled journey](/presets/passenger-trips.png)

5. Switch to French under **My settings → Français**, and open the sidebar.

> ✅ Expected: **Véhicules** and **Voyages**. Sign in to `transports-ngwa` in French and compare: **Camions** and **Trajets**.

6. Sign in as `eric` (Driver).

> ✅ Expected: the short Dashboard with **Vehicles in service** and **Recent entries**, and a sidebar with **Dashboard**, **Vehicles** and **Trips**.

![The passenger Driver's Dashboard](/presets/passenger-driver.png)

## Run the lessons in the passenger company

Every lesson in **Daily work** works here too. Use the passenger accounts:

| Role | Passenger account |
| --- | --- |
| Director | `josiane` |
| Administrator | `paul` |
| Finance | `aline` |
| Cashier | `grace` (Douala) |
| Technician | `bertrand` |
| Driver | `eric` |

## Try to break it

- **Truck in a passenger company.** On every passenger page, look for the word truck (or camion, trajet in French). Each one is a bug: write down the page and the exact text.
- **Vehicle in a trucking company.** The other way round: in `transports-ngwa`, look for vehicle where the page should say truck. Each one is a bug.
- **The word asset.** "Asset" is an internal word. It should never show on screen in either company.
- **Same rules.** Repeat the approval and grounding checks of the trucking lessons here. The bands and rules must behave the same.

## Report it

Use the template in [Reporting bugs](/testing/reporting-bugs). Put `littoral-voyages` in the **Workspace** line.

Next: [How to test](/testing/how-to-test)
