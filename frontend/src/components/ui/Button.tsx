import type { ButtonHTMLAttributes } from "react";
import { buttonClasses, type ButtonStyleOptions } from "./buttonStyles";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleOptions;

export function Button({ variant, size, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...rest} />;
}
