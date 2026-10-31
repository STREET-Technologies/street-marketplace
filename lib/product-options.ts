import type { ProductDetail } from "./contracts.ts";

export type ProductOption = { name: string; values: string[] };
export type OptionSelection = Record<string, string>;
type Variant = ProductDetail["variants"][number];
export type OptionModel = {
  options: ProductOption[];
  variants: { variant: Variant; values: OptionSelection }[];
};
export const isColourOption = (name: string) =>
  /^(colou?r)$/i.test(name.trim());

// Match whole backend values in option order. A value itself can contain " / ".
// Never manufacture combinations or silently choose an ambiguous variant.
export function buildOptionModel(product: ProductDetail): OptionModel | null {
  const options = product.options;
  if (
    !options?.length ||
    options.length > 10 ||
    !product.variants.length ||
    new Set(options.map((o) => o.name)).size !== options.length ||
    options.some(
      (o) =>
        !o.name ||
        !o.values.length ||
        o.values.some((v) => !v) ||
        new Set(o.values).size !== o.values.length,
    )
  )
    return null;
  const variants: OptionModel["variants"] = [];
  const combinations = new Set<string>();
  for (const variant of product.variants) {
    const matches: OptionSelection[] = [];
    let attempts = 0;
    function match(index: number, remaining: string, values: OptionSelection) {
      if (++attempts > 1000 || matches.length > 1) return;
      if (index === options!.length) {
        if (!remaining) matches.push(values);
        return;
      }
      const option = options![index];
      for (const value of option.values) {
        const part = value + (index < options!.length - 1 ? " / " : "");
        if (remaining.startsWith(part))
          match(index + 1, remaining.slice(part.length), {
            ...values,
            [option.name]: value,
          });
      }
    }
    match(0, variant.title, {});
    if (matches.length !== 1 || attempts > 1000) return null;
    const key = JSON.stringify(options.map((o) => matches[0][o.name]));
    if (combinations.has(key)) return null;
    combinations.add(key);
    variants.push({ variant, values: matches[0] });
  }
  return { options, variants };
}

export function defaultOptions(model: OptionModel): OptionSelection {
  return Object.fromEntries(
    model.options
      .filter((o) => o.values.length === 1)
      .map((o) => [o.name, o.values[0]]),
  );
}
export function matchingOptions(
  model: OptionModel,
  selection: OptionSelection,
) {
  return model.variants.filter((v) =>
    Object.entries(selection).every(
      ([name, value]) => v.values[name] === value,
    ),
  );
}
export function selectedOptionVariant(
  model: OptionModel,
  selection: OptionSelection,
): Variant | undefined {
  if (!model.options.every((o) => o.values.includes(selection[o.name]))) return;
  const matches = matchingOptions(model, selection);
  return matches.length === 1 ? matches[0].variant : undefined;
}
export function chooseOption(
  model: OptionModel,
  selection: OptionSelection,
  name: string,
  value: string,
): OptionSelection {
  const next = { ...selection, [name]: value };
  // Retain other choices when the combination exists, including out-of-stock
  // variants. Otherwise clear conflicting choices so a stale variant can't leak.
  return matchingOptions(model, next).length
    ? next
    : { ...defaultOptions(model), [name]: value };
}

function explicitUkSize(value: string): string | null {
  const parts = value
    .split(/\s*\/\s*/)
    .map((part) => /^(UK|EU|US)\s*(\d+(?:\.\d+)?)$/i.exec(part));
  if (
    parts.length < 2 ||
    parts.some((p) => !p) ||
    new Set(parts.map((p) => p![1].toUpperCase())).size !== parts.length
  )
    return null;
  return parts.find((p) => p![1].toUpperCase() === "UK")?.[2] ?? null;
}
export function optionLabels(option: ProductOption) {
  const uk =
    option.name.trim().toLowerCase() === "size"
      ? option.values.map(explicitUkSize)
      : [];
  const useUk =
    uk.length > 0 &&
    uk.every((v) => v !== null) &&
    new Set(uk).size === uk.length;
  return {
    name: useUk
      ? "Size (UK)"
      : isColourOption(option.name)
        ? "Colour"
        : option.name,
    values: option.values.map((value, index) => ({
      value,
      label: useUk ? uk[index]! : value,
    })),
  };
}
