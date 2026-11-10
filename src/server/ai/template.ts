// Điền biến {{idea}} {{style}} {{camera}} {{aspect}} {{duration}} {{shots}} vào template skill.
export type TemplateVars = Partial<Record<"idea" | "style" | "camera" | "aspect" | "duration" | "shots", string | number>>;

export const TEMPLATE_VARS = ["idea", "style", "camera", "aspect", "duration", "shots"] as const;

const UNSET = "not specified, choose what fits the idea";

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
    const v = (vars as Record<string, string | number | undefined>)[name];
    if (v === undefined || v === null || v === "") return (TEMPLATE_VARS as readonly string[]).includes(name) ? UNSET : "";
    return String(v);
  });
}

export function presetText(preset: { name: string; promptSuffix: string } | null | undefined): string | undefined {
  return preset ? `${preset.name} — ${preset.promptSuffix}` : undefined;
}
