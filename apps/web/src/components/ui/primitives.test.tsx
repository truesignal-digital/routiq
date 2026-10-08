import { readFileSync } from "fs"
import { resolve } from "path"
import { describe, it, expect, afterEach, beforeAll } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/data-table"
import { DateRangePicker } from "@/components/date-range-picker"
import { FilterChips } from "@/components/filter-chips"
import { i18n } from "@/i18n/index.js"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
} from "@/components/ui/sheet"

describe("UI Primitives", () => {
  it("renders Tabs", () => {
    const { container } = render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    )
    expect(container.querySelector('[role="tablist"]')).toBeTruthy()
  })

  it("renders Checkbox", () => {
    const { container } = render(<Checkbox />)
    expect(container.querySelector('[role="checkbox"]')).toBeTruthy()
  })

  it("renders DropdownMenu trigger", () => {
    const { getByText } = render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    expect(getByText("Menu")).toBeTruthy()
  })

  it("renders Popover trigger", () => {
    const { getByText } = render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>
    )
    expect(getByText("Open")).toBeTruthy()
  })

  it("renders Alert", () => {
    const { container } = render(
      <Alert>
        <AlertTitle>Title</AlertTitle>
        <AlertDescription>Description</AlertDescription>
      </Alert>
    )
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
  })

  it("renders Tooltip trigger", () => {
    const { getByText } = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    expect(getByText("Hover me")).toBeTruthy()
  })

  it("renders Sheet trigger", () => {
    const { getByText } = render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>Content</SheetContent>
      </Sheet>
    )
    expect(getByText("Open")).toBeTruthy()
  })
})

/**
 * Phones are the main device (#23): every interactive primitive gives a
 * 44 x 44 px hit area at its default size. A compact look exists only behind
 * the `desktop:` variant (wide screen with a mouse), so a phone never gets a
 * silent 28 px target.
 */
const TALL = /^(?:min-)?h-11$|^size-11$|^group-data-horizontal\/tabs:h-11$/
const WIDE = /^(?:min-)?w-11$|^size-11$/
const SMALLER = /^(?:min-)?h-(?:\d|10|\[.*\])$|^size-(?:\d|10)$/

function classesOf(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
}

function expectTouchTarget(element: Element, { square = false } = {}) {
  const classes = classesOf(element)
  const label = element.getAttribute("aria-label") ?? element.textContent ?? element.tagName
  expect(classes.some((name) => TALL.test(name)), `${label}: ${classes.join(" ")}`).toBe(true)
  if (square) {
    expect(classes.some((name) => WIDE.test(name)), `${label} width: ${classes.join(" ")}`).toBe(true)
  }
  // Only the desktop variant may shrink it.
  expect(classes.filter((name) => SMALLER.test(name)), label).toEqual([])
}

describe("touch targets: 44 px on phone by default", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en")
  })
  afterEach(cleanup)
  const t = (key: string) => i18n.t(key)

  it("Button, at its default and icon sizes", () => {
    render(
      <>
        <Button>Save</Button>
        <Button size="icon" aria-label="Icon" />
      </>,
    )
    expectTouchTarget(screen.getByRole("button", { name: "Save" }))
    expectTouchTarget(screen.getByRole("button", { name: "Icon" }), { square: true })
  })

  it("Button compact sizes shrink on desktop only", () => {
    render(
      <>
        <Button size="desktop-sm">Small</Button>
        <Button size="desktop-icon-sm" aria-label="Small icon" />
      </>,
    )
    const small = screen.getByRole("button", { name: "Small" })
    const icon = screen.getByRole("button", { name: "Small icon" })
    expectTouchTarget(small)
    expectTouchTarget(icon, { square: true })
    expect(classesOf(small)).toContain("desktop:h-8")
    expect(classesOf(icon)).toContain("desktop:size-8")
  })

  it("Input", () => {
    render(<Input aria-label="Plate" />)
    expectTouchTarget(screen.getByRole("textbox", { name: "Plate" }))
  })

  it("SelectTrigger, default and desktop-sm", () => {
    render(
      <>
        <Select>
          <SelectTrigger aria-label="Branch">
            <SelectValue />
          </SelectTrigger>
        </Select>
        <Select>
          <SelectTrigger aria-label="Rows" size="desktop-sm">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </>,
    )
    expectTouchTarget(screen.getByRole("combobox", { name: "Branch" }))
    const rows = screen.getByRole("combobox", { name: "Rows" })
    expectTouchTarget(rows)
    expect(classesOf(rows)).toContain("data-[size=desktop-sm]:desktop:h-8")
  })

  it("TabsList", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expectTouchTarget(screen.getByRole("tablist"))
    // The list is 44 px; the trigger inside it reaches the list's edges.
    const trigger = classesOf(screen.getByRole("tab", { name: "A" }))
    expect(trigger).toContain("group-data-horizontal/tabs:before:-inset-y-1")
  })

  it("sheet and dialog close buttons", () => {
    render(
      <>
        <Sheet open>
          <SheetContent>Sheet body</SheetContent>
        </Sheet>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    )
    const closes = document.querySelectorAll('[data-slot="sheet-close"], [data-slot="dialog-close"]')
    expect(closes).toHaveLength(2)
    closes.forEach((close) => expectTouchTarget(close, { square: true }))
  })

  it("Calendar day and month buttons", () => {
    render(<Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} />)
    const buttons = screen.getAllByRole("button")
    // 42 days + previous/next year + previous/next month.
    expect(buttons).toHaveLength(46)
    buttons.forEach((button) => expectTouchTarget(button, { square: true }))
  })

  it("date-range trigger", () => {
    render(<DateRangePicker onFromChange={() => {}} onToChange={() => {}} />)
    expectTouchTarget(screen.getAllByRole("button")[0]!)
  })

  it("filter chips", () => {
    render(
      <FilterChips
        label="Status"
        options={[
          { key: "ALL", label: "All" },
          { key: "OPEN", label: "Open", count: 2 },
        ]}
        value="ALL"
        onChange={() => {}}
      />,
    )
    screen.getAllByRole("radio").forEach((chip) => expectTouchTarget(chip, { square: true }))
  })

  describe("DataTable controls", () => {
    type Row = { name: string; status: string }
    const columns: DataTableColumn<Row>[] = [
      { accessorKey: "name", header: "Name", enableSorting: true, meta: { phone: "title", label: "Name" } },
      { accessorKey: "status", header: "Status", meta: { phone: "meta", label: "Status" } },
    ]
    const data: Row[] = Array.from({ length: 30 }, (_, index) => ({
      name: `Row ${index}`,
      status: index % 2 === 0 ? "A" : "B",
    }))
    const filters: DataTableFilter[] = [
      { columnId: "name", type: "search", placeholder: "Search" },
      { columnId: "status", type: "select", placeholder: "Status", options: [{ value: "A", label: "Alpha" }] },
    ]

    function renderTable() {
      render(
        <DataTable
          columns={columns}
          data={data}
          pagination={{ defaultPageSize: 10 }}
          enableColumnVisibility
          filters={filters}
          filterValues={{ status: "A" }}
          onFilterChange={() => {}}
          rowActions={() => [{ key: "open", label: "Open", onSelect: () => {} }]}
        />,
      )
    }

    it("toolbar: search, filter select, clear filters, view options", () => {
      renderTable()
      expectTouchTarget(screen.getByRole("searchbox", { name: "Search" }))
      expectTouchTarget(screen.getByRole("combobox", { name: "Status" }))
      expectTouchTarget(screen.getByRole("button", { name: t("dataTable.clearFilters") }))
      expectTouchTarget(screen.getByRole("button", { name: t("dataTable.view") }))
    })

    it("sort headers, row menu, pager and rows per page", () => {
      renderTable()
      expectTouchTarget(within(screen.getByRole("columnheader", { name: /Name/ })).getByRole("button"))
      screen
        .getAllByRole("button", { name: t("dataTable.actions") })
        .forEach((menu) => expectTouchTarget(menu, { square: true }))
      for (const name of ["firstPage", "previousPage", "nextPage", "lastPage"]) {
        expectTouchTarget(screen.getByRole("button", { name: t(`dataTable.${name}`) }), { square: true })
      }
      expectTouchTarget(screen.getByRole("combobox", { name: t("dataTable.rowsPerPage") }))
    })

    it("row menu on the phone list rows", async () => {
      const desktop = window.matchMedia
      window.matchMedia = (query: string) => ({ ...desktop(query), matches: false })
      try {
        renderTable()
        const menus = await screen.findAllByRole("button", { name: t("dataTable.actions") })
        menus.forEach((menu) => expectTouchTarget(menu, { square: true }))
      } finally {
        window.matchMedia = desktop
      }
    })
  })

  it("keeps the desktop variant tied to a wide screen with a fine pointer", () => {
    const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf-8")
    expect(css).toMatch(/@custom-variant desktop \(@media \(width >= 48rem\) and \(pointer: fine\)\);/)
  })
})

