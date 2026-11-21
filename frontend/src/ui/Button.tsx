import { type ComponentProps, splitProps } from "solid-js";

export type ButtonProps = ComponentProps<"button"> & {
  variant?:
    | "neutral"
    | "floating"
    | "glass"
    | "primary"
    | "success"
    | "reject"
    | "stop"
    | "ghost";
  size?: "md" | "sm" | "icon-sm" | "icon" | "icon-lg";
  radius?: "sm" | "lg";
  pill?: boolean;
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "radius",
    "pill",
    "class",
    "classList",
  ]);
  const variant = () => local.variant ?? "neutral";
  const size = () => local.size ?? "md";
  const round = () => Boolean(local.pill) || size().startsWith("icon");
  const radius = () =>
    local.radius ??
    (variant() === "glass" ? "xl" : size() === "md" ? "lg" : "sm");
  return (
    <button
      type="button"
      {...rest}
      class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 font-semibold no-underline transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      classList={{
        "px-4 py-2 text-[0.85rem]": size() === "md",
        "px-3 py-1.5 text-[0.8rem]": size() === "sm",
        "size-5 p-0": size() === "icon-sm",
        "size-8 p-0": size() === "icon",
        "size-11 p-0": size() === "icon-lg",
        "rounded-xl": !round() && radius() === "xl",
        "rounded-lg": !round() && radius() === "lg",
        rounded: !round() && radius() === "sm",
        "rounded-full": round(),
        "border-0": variant() !== "glass",
        "border border-border": variant() === "glass",
        "bg-subtle-bg text-text enabled:hover:bg-bg": variant() === "neutral",
        "bg-surface text-text backdrop-blur-md supports-backdrop-filter:bg-glass supports-backdrop-filter:enabled:hover:bg-surface/90":
          variant() === "floating" || variant() === "glass",
        "shadow-floating": variant() === "floating",
        "bg-accent text-white enabled:hover:bg-accent-hover":
          variant() === "primary",
        "bg-ok-dark text-white enabled:hover:bg-ok-hover":
          variant() === "success",
        "bg-reject text-white enabled:hover:bg-reject-hover":
          variant() === "reject",
        "bg-error text-white enabled:hover:bg-reject-hover":
          variant() === "stop",
        "bg-transparent text-muted enabled:hover:text-text":
          variant() === "ghost",
        ...local.classList,
        [local.class ?? ""]: Boolean(local.class),
      }}
    />
  );
}
