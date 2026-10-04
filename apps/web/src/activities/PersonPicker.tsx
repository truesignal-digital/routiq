import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CommandClient } from "../commands/instance.js";
import { RegisterPersonDialog } from "./RegisterPersonDialog.js";
import { usePersons } from "./usePersons.js";

export interface PersonPickerProps {
  /** Selected person id, or "" for none. */
  value: string;
  onChange: (personId: string) => void;
  /** Branch a person registered from here belongs to. */
  branchCode: string;
  /** Narrows the list; omit to show every person in scope. */
  branchId?: string;
  /** Accessible name for the trigger — crew rows repeat this control. */
  label?: string;
  disabled?: boolean;
  className?: string;
  client?: CommandClient;
}

/**
 * A driver by name, or a driver who does not exist yet. Crew capture stalls if
 * the clerk has to leave the sheet to register someone, so registering is an
 * item in the same list — and the new person comes back selected.
 */
export function PersonPicker({
  value,
  onChange,
  branchCode,
  branchId,
  label,
  disabled = false,
  className,
  client,
}: PersonPickerProps) {
  const { t } = useTranslation();
  const commandLabel = useCommandLabel();
  const [open, setOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [search, setSearch] = useState("");

  const personsQuery = usePersons({
    active: true,
    ...(branchId === undefined ? {} : { branchId }),
  });
  const persons = personsQuery.data?.items ?? [];

  // The list is a branch's worth of people; filtering what is already in hand
  // beats a request per keystroke on an intermittent link.
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return persons;
    return persons.filter(
      (person) =>
        person.displayName.toLowerCase().includes(needle) ||
        (person.personCode ?? "").toLowerCase().includes(needle),
    );
  }, [persons, search]);

  const selected = persons.find((person) => person.id === value);
  const triggerLabel =
    selected?.displayName ?? t("activities.pickers.person.placeholder");

  function select(personId: string) {
    onChange(personId);
    setSearch("");
    setOpen(false);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className={cn(
                "min-h-11 w-full justify-between font-normal",
                selected === undefined && "text-muted-foreground",
                className,
              )}
              {...(label === undefined ? {} : { "aria-label": label })}
            />
          }
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("activities.pickers.person.searchPlaceholder")}
            aria-label={t("activities.pickers.person.search")}
            className="min-h-10"
          />

          {personsQuery.isPending ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t("activities.pickers.person.loading")}
            </p>
          ) : personsQuery.isError ? (
            <p role="alert" className="px-1 py-2 text-xs text-destructive">
              {t("activities.pickers.person.loadFailed")}
            </p>
          ) : matches.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t("activities.pickers.person.empty")}
            </p>
          ) : (
            <ul role="listbox" className="max-h-56 overflow-y-auto">
              {matches.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={person.id === value}
                    onClick={() => select(person.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-muted aria-selected:bg-muted"
                  >
                    <span className="truncate">{person.displayName}</span>
                    {person.defaultRole !== null && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t(`persons.roles.${person.defaultRole}`)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Button
            type="button"
            variant="ghost"
            className="min-h-10 justify-start"
            onClick={() => {
              setOpen(false);
              setRegistering(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            {commandLabel("register-person")}
          </Button>
        </PopoverContent>
      </Popover>

      <RegisterPersonDialog
        open={registering}
        onOpenChange={setRegistering}
        branchCode={branchCode}
        onRegistered={(personId) => select(personId)}
        {...(client === undefined ? {} : { client })}
      />
    </>
  );
}
