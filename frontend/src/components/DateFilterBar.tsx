import { useState } from "react";
import { format, subDays, startOfMonth, startOfDay, endOfDay } from "date-fns";
import { CalendarIcon, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateFilterBarProps {
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
}

const presets = [
  { label: "Today", getRange: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: "Yesterday", getRange: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }) },
  { label: "Last 7 Days", getRange: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }) },
  { label: "This Month", getRange: () => ({ from: startOfMonth(new Date()), to: endOfDay(new Date()) }) },
];

export function DateFilterBar({ from, to, onChange }: DateFilterBarProps) {
  const [tempFrom, setTempFrom] = useState<Date | undefined>(from);
  const [tempTo, setTempTo] = useState<Date | undefined>(to);

  const applyPreset = (preset: typeof presets[0]) => {
    const range = preset.getRange();
    onChange(range.from, range.to);
    setTempFrom(range.from);
    setTempTo(range.to);
  };

  const handleReset = () => {
    const range = presets[2].getRange(); // Last 7 Days default
    onChange(range.from, range.to);
    setTempFrom(range.from);
    setTempTo(range.to);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal gap-2 min-w-[130px]", !tempFrom && "text-muted-foreground")}>
            <CalendarIcon className="h-3.5 w-3.5" />
            {tempFrom ? format(tempFrom, "dd MMM yyyy") : "From"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={tempFrom}
            onSelect={(d) => {
              setTempFrom(d);
              if (d && tempTo) onChange(d, tempTo);
            }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      <span className="text-xs text-muted-foreground">to</span>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal gap-2 min-w-[130px]", !tempTo && "text-muted-foreground")}>
            <CalendarIcon className="h-3.5 w-3.5" />
            {tempTo ? format(tempTo, "dd MMM yyyy") : "To"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={tempTo}
            onSelect={(d) => {
              setTempTo(d);
              if (d && tempFrom) onChange(tempFrom, d);
            }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      <div className="h-6 w-px bg-border mx-1 hidden sm:block" />

      {presets.map(p => (
        <Button key={p.label} variant="ghost" size="sm" className="text-xs h-7 px-2.5" onClick={() => applyPreset(p)}>
          {p.label}
        </Button>
      ))}

      <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground" onClick={handleReset}>
        <RotateCcw className="h-3 w-3 mr-1" /> Reset
      </Button>
    </div>
  );
}
