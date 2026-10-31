"use client";
import type { ProductDetail } from "../lib/contracts";
import {
  chooseOption,
  isColourOption,
  matchingOptions,
  optionLabels,
  type OptionModel,
  type OptionSelection,
} from "../lib/product-options";

function OptionButton({ label, active, outOfStock, unavailable = false, onClick }: {
  label: string;
  active: boolean;
  outOfStock: boolean;
  unavailable?: boolean;
  onClick: () => void;
}) {
  const status = outOfStock ? "Out of stock" : unavailable ? "Unavailable" : null;
  return <button
    aria-pressed={active}
    aria-label={status ? `${label}, ${status}` : label}
    className={[active ? "selected" : "", status ? "option-unavailable" : ""].filter(Boolean).join(" ")}
    disabled={unavailable}
    onClick={onClick}
  >{label}{status && <svg className="option-strike" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="100" x2="100" y2="0" vectorEffect="non-scaling-stroke" /></svg>}</button>;
}

export function ProductOptions({
  product,
  model,
  values,
  selected,
  onOptions,
  onVariant,
}: {
  product: ProductDetail;
  model: OptionModel | null;
  values: OptionSelection;
  selected: ProductDetail["variants"][number] | undefined;
  onOptions: (selection: OptionSelection) => void;
  onVariant: (id: string) => void;
}) {
  if (!model)
    return (
      <fieldset className="product-options">
        <legend>Choose an option</legend>
        <div className="sizes">
          {product.variants.map((v) => (
            <OptionButton key={v.id} label={v.title} active={selected?.id === v.id}
              outOfStock={v.inventory === 0} onClick={() => onVariant(v.id)} />
          ))}
        </div>
      </fieldset>
    );
  return (
    <div className="product-options">
      {[...model.options]
        .sort(
          (a, b) =>
            Number(isColourOption(b.name)) - Number(isColourOption(a.name)),
        )
        .map((option) => {
          const labels = optionLabels(option);
          if (option.values.length === 1)
            return option.name.toLowerCase() === "title" ? null : (
              <p className="product-option-fixed" key={option.name}>
                {labels.name}: <span>{labels.values[0].label}</span>
              </p>
            );
          return (
            <fieldset key={option.name}>
              <legend>{labels.name}</legend>
              <div className="sizes">
                {labels.values.map(({ value, label }) => {
                  const next = chooseOption(model, values, option.name, value);
                  const matches = matchingOptions(model, next);
                  const out =
                    matches.length > 0 &&
                    matches.every((v) => v.variant.inventory === 0);
                  const unavailable = matches.length === 0;
                  const active = values[option.name] === value;
                  return (
                    <OptionButton key={value} label={label} active={active}
                      outOfStock={out} unavailable={unavailable} onClick={() => onOptions(next)} />
                  );
                })}
              </div>
            </fieldset>
          );
        })}
    </div>
  );
}
