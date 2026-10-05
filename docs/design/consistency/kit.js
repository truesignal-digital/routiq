// Lucide-style icon sprite + the annotation toggle shared by every mockup page.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-7h6v7"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 8.38A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  fuel: '<path d="M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  pen: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  wifioff: '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M2 2l20 20"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  box: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
};

let markSeq = 0;
// The ROUTIQ mark, paths copied from components/brand/routiq-logo.tsx (feat/brand-identity).
function routiqMark(cls = "") {
  const id = `rm${markSeq++}`;
  const counter = "M58 17.5a13 13 0 0 1 13 13c0 7.6-6.2 12.8-13 21.5c-6.8-8.7-13-13.9-13-21.5a13 13 0 0 1 13-13z";
  const road = "M53 50C37 53 16 70 4 93H43C45 74 51 60 62 50Z";
  const pin = "M58 22.5a7.5 7.5 0 0 1 7.5 7.5c0 4.4-3.6 7.4-7.5 12.5c-3.9-5.1-7.5-8.1-7.5-12.5a7.5 7.5 0 0 1 7.5-7.5z";
  return `<svg class="mark ${cls}" viewBox="0 0 100 100" aria-hidden="true"><defs>
<mask id="${id}b" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><path d="${counter}" fill="#000"/><path d="${road}" fill="#000" stroke="#000" stroke-width="7" stroke-linejoin="round"/><path d="M53 50C37 53 16 70 4 93L0 100V40Z" fill="#000"/></mask>
<mask id="${id}r" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><path d="M57.5 51C44 56 31 70 24 93" fill="none" stroke="#000" stroke-width="2.6" stroke-dasharray="5 5" stroke-dashoffset="2"/></mask>
<mask id="${id}p" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><circle cx="58" cy="30" r="2.8" fill="#000"/></mask></defs>
<g fill="currentColor"><g mask="url(#${id}b)"><path d="M29 7H59C75 7 85.5 17.5 85.5 31.5C85.5 46 74.5 56.5 59 56.5H29Z"/><rect x="29" y="7" width="17" height="60"/><path d="M55 49H72L91 93H71Z"/></g><path mask="url(#${id}r)" d="${road}"/></g>
<path class="mk-pin" mask="url(#${id}p)" d="${pin}"/></svg>`;
}

function icon(name, cls = "") {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

// <i data-i="truck"></i> becomes an inline icon; data-c adds classes.
function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-i]").forEach((el) => {
    el.outerHTML = icon(el.dataset.i, el.dataset.c ?? "");
  });
}

// Proposed navigation (sidebar.html). Places only, grouped, gated by role; data, not code.
const NAV = [
  { group: "Daily work", items: [
    ["home", "home", "Home"],
    ["truck", "trucks", "Trucks"],
    ["route", "trips", "Trips"],
    ["wrench", "maintenance", "Maintenance", 2],
    ["money", "money", "Money", 2],
    ["box", "stock", "Stock", 3, "future"],
  ]},
  { group: "Company", items: [
    ["user", "personnel", "Personnel"],
    ["building", "branches", "Branches"],
    ["cal", "months", "Accounting months"],
    ["building", "partners", "Partners", 1, "future"],
    ["sliders", "companysettings", "Company settings"],
  ]},
];
const ROLES = {
  admin: { name: "Boris Mbarga", role: "Administrator · Douala", sees: null },
  driver: { name: "Sali Ahmadou", role: "Driver · Douala", sees: ["home", "trucks", "trips"] },
  workshop: { name: "Hervé Nkou", role: "Technician · Douala", sees: ["home", "trucks", "maintenance", "stock"] },
  finance: { name: "Nadège Eto'o", role: "Finance · all branches", sees: ["home", "trucks", "trips", "money", "months"] },
  exec: { name: "Amadou Bello", role: "Direction · all branches", sees: ["home", "trucks", "trips", "maintenance", "money"], quiet: true },
};
const ALIASES = { finance: "money", entries: "money", approvals: "money", periods: "months", more: "branches", settings: "branches" };

function sidebar(active, roleKey = "admin") {
  const role = ROLES[roleKey] ?? ROLES.admin;
  const on = ALIASES[active] ?? active;
  const groups = NAV.map(({ group, items }) => {
    const showFuture = document.body.dataset.future !== undefined;
    const visible = items.filter(([, k, , , f]) => (role.sees === null || role.sees.includes(k)) && (f !== "future" || showFuture));
    if (visible.length === 0) return "";
    return `<div class="glabel">${group}</div>${visible
      .map(([i, k, l, n]) => `<div class="item ${k === on ? "on" : ""}">${icon(i)}<span>${l}</span>${n && !role.quiet ? `<span class="nb">${n}</span>` : ""}</div>`)
      .join("")}`;
  }).join("");
  return `<aside class="sb"><div class="ws">${routiqMark()}<span><span class="wordmark">Routi<b>q</b></span><span class="wsname">Transports Ngwa</span></span></div>${groups}<div class="soon">${icon("clock")}<span>What's coming</span><span class="nb q">10</span></div><div class="who"><span class="av">${role.name[0]}</span><span><b>${role.name}</b>${role.role}</span>${icon("chev")}</div></aside>`;
}

// Phone: three places picked per role, then Menu (the full sidebar as a sheet).
const PHONE = {
  admin: [["home", "home", "Home"], ["truck", "trucks", "Trucks"], ["money", "money", "Money"]],
  exec: [["home", "home", "Overview"], ["truck", "trucks", "Trucks"], ["money", "money", "Money"]],
  driver: [["home", "home", "Home"], ["truck", "trucks", "My truck"], ["route", "trips", "Trips"]],
  workshop: [["home", "home", "Home"], ["wrench", "maintenance", "Maintenance"], ["truck", "trucks", "Trucks"]],
  finance: [["home", "home", "Home"], ["money", "money", "Money"], ["truck", "trucks", "Trucks"]],
};
function phoneTabbar(active, roleKey = "admin") {
  const on = ALIASES[active] ?? active;
  const items = [...(PHONE[roleKey] ?? PHONE.admin), ["menu", "menu", "Menu"]];
  return `<nav class="tabbar">${items.map(([i, k, l]) => `<div class="${k === on ? "on" : ""}">${icon(i, "lg")}${l}</div>`).join("")}</nav>`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-sidebar]").forEach((el) => (el.outerHTML = sidebar(el.dataset.sidebar, el.dataset.role)));
  document.querySelectorAll("[data-tabbar]").forEach((el) => (el.outerHTML = phoneTabbar(el.dataset.tabbar, el.dataset.role)));
  document.querySelectorAll("[data-mark]").forEach((el) => (el.outerHTML = routiqMark(el.dataset.mark)));
  hydrateIcons();
  const params = new URLSearchParams(location.search);
  if (params.get("notes") !== "0") document.body.classList.add("notes-on");
  const btn = document.querySelector(".toggle-notes button");
  if (btn) btn.addEventListener("click", () => document.body.classList.toggle("notes-on"));
  // Theme: the neutral theme on develop, or the unmerged brand-identity navy.
  const wrap = document.querySelector(".toggle-notes");
  const fixedTheme = document.body.dataset.fixedTheme !== undefined;
  const theme = params.get("theme") ?? "neutral";
  const applyTheme = (name) => {
    if (fixedTheme) return;
    document.body.classList.toggle("theme-brand", name === "brand");
    localStorage.setItem("routiq-mock-theme", name);
    if (themeBtn) themeBtn.textContent = name === "brand" ? "Theme: brand navy (unmerged)" : "Theme: neutral (develop)";
  };
  let themeBtn;
  if (wrap) {
    themeBtn = document.createElement("button");
    themeBtn.type = "button";
    themeBtn.style.marginTop = "8px";
    themeBtn.addEventListener("click", () => applyTheme(document.body.classList.contains("theme-brand") ? "neutral" : "brand"));
    wrap.appendChild(themeBtn);
  }
  applyTheme(theme);
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".doc-nav a[href]").forEach((a) => {
    if (a.getAttribute("href") === here) a.classList.add("here");
  });
});
