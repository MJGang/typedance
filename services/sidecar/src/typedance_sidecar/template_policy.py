from __future__ import annotations

from .models import PdfClassPolicy, PdfClassValidationError, TemplateStyleConfig


DEFAULT_PDF_CLASS_POLICY = PdfClassPolicy(
    allowlist=[
        "bg-white",
        "text-slate-900",
        "text-slate-700",
        "text-blue-800",
        "font-sans",
        "font-bold",
        "font-semibold",
        "text-sm",
        "text-base",
        "text-xl",
        "leading-normal",
        "leading-relaxed",
        "border-b",
        "border-b-2",
        "border-blue-800",
        "pb-3",
        "mb-4",
        "mt-4",
        "space-y-2",
        "grid",
        "gap-2",
    ],
    blocklist=[
        "fixed",
        "sticky",
        "absolute",
        "animate-spin",
        "transition",
        "blur",
        "drop-shadow",
        "hover:bg-white",
        "focus:ring",
    ],
    groups={},
)


def split_classes(class_name: str) -> list[str]:
    return [item.strip() for item in class_name.split() if item.strip()]


def validate_style_config(config: TemplateStyleConfig, policy: PdfClassPolicy) -> list[PdfClassValidationError]:
    allowed = set(policy.allowlist)
    blocked = set(policy.blocklist)
    errors: list[PdfClassValidationError] = []

    for group in policy.groups.values():
        allowed.update(group.allowlist)
        blocked.update(group.blocklist)

    for slot_name, slot in config.slots.items():
        for class_name in split_classes(slot.class_name):
            if class_name in blocked:
                errors.append(PdfClassValidationError(slot=slot_name, class_name=class_name, reason="blocked"))
            elif class_name not in allowed:
                errors.append(PdfClassValidationError(slot=slot_name, class_name=class_name, reason="not_allowed"))

    return errors
