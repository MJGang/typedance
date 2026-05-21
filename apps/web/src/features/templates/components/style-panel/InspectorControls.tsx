import type { ComponentProps, ComponentType, ReactNode, SVGProps } from "react";
import { ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type InspectorIcon = ComponentType<SVGProps<SVGSVGElement>>;

type InspectorSectionProps = {
  value: string;
  title: string;
  icon: InspectorIcon;
  summary?: ReactNode;
  children: ReactNode;
};

type InspectorRowsProps = {
  className?: string;
  children: ReactNode;
};

type InspectorRowProps = {
  label: string;
  icon?: InspectorIcon;
  className?: string;
  controlClassName?: string;
  children: ReactNode;
};

export function InspectorAccordion({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="inspector-accordion"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

export function InspectorSection({ value, title, icon: Icon, summary, children }: InspectorSectionProps) {
  return (
    <AccordionPrimitive.Item value={value} className="border-b border-border/70 last:border-b-0">
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger className="group flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-muted/60 data-[state=open]:bg-transparent [&[data-state=open]>svg:first-child]:rotate-0">
          <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-200" />
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          {summary ? <span className="max-w-28 truncate text-xs font-normal text-muted-foreground">{summary}</span> : null}
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:hidden">
        <div className="px-2 pb-3 pt-1">{children}</div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

export function InspectorRows({ className, children }: InspectorRowsProps) {
  return <div className={cn("divide-y divide-border/60", className)}>{children}</div>;
}

export function InspectorRow({ label, icon: Icon, className, controlClassName, children }: InspectorRowProps) {
  return (
    <div className={cn("grid min-h-11 grid-cols-[minmax(0,5.75rem)_minmax(0,1fr)] items-center gap-3 py-1.5", className)}>
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("flex min-w-0 items-center justify-end gap-2", controlClassName)}>
        {children}
      </div>
    </div>
  );
}
