import { splitProps } from "solid-js";
import { Button, type ButtonProps } from "./Button";

type IconButtonProps = Omit<ButtonProps, "size"> & {
  "aria-label": string;
  size?: "md" | "lg";
};

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["size"]);
  return <Button {...rest} size={local.size === "lg" ? "icon-lg" : "icon"} />;
}
