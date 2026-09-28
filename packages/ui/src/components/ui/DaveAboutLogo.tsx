import { cn } from "@/components/lib/utils.js";

export function DaveAboutLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 3h8c4.8 0 8 3.7 8 9s-3.2 9-8 9H5V3Zm4 3.8v10.4h3.6c2.7 0 4.6-2.1 4.6-5.2s-1.9-5.2-4.6-5.2H9Z" />
    </svg>
  );
}

export function DaveWordmarkLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 3h8c4.8 0 8 3.7 8 9s-3.2 9-8 9H5V3Zm4 3.8v10.4h3.6c2.7 0 4.6-2.1 4.6-5.2s-1.9-5.2-4.6-5.2H9Z" />
    </svg>
  );
}
