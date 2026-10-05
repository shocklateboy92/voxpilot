import { type ComponentProps, splitProps } from "solid-js";

export type ButtonProps = ComponentProps<"button"> & {
  variant?: "neutral" | "primary" | "success" | "reject" | "stop" | "ghost";
  size?: "md" | "sm" | "icon" | "icon-lg";
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "class",
    "classList",
  ]);
  const variant = () => local.variant ?? "neutral";
  const size = () => local.size ?? "md";
  return (
    <button
      type="button"
      {...rest}
      class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 border-0 font-semibold no-underline transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      classList={{
        "rounded-lg px-4 py-2 text-[0.85rem]": size() === "md",
        "rounded px-3 py-1.5 text-[0.8rem]": size() === "sm",
        "size-8 rounded-full p-0": size() === "icon",
        "size-11 rounded-full p-0": size() === "icon-lg",
        "bg-subtle-bg text-text enabled:hover:bg-bg": variant() === "neutral",
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
