"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ConfirmSubmitProps = Omit<ComponentProps<typeof Button>, "type" | "onClick"> & {
  message: string;
  children: ReactNode;
};

export function ConfirmSubmit({ message, children, ...props }: ConfirmSubmitProps) {
  return (
    <Button
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
