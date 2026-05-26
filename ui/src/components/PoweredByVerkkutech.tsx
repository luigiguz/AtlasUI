type Props = {
  /** Más pequeño para login u otras vistas */
  compact?: boolean;
  /** Mínimo para el pie del sidebar */
  mini?: boolean;
  className?: string;
};

export function PoweredByVerkkutech({ compact = false, mini = false, className = "" }: Props) {
  const small = compact || mini;
  return (
    <div
      className={`flex flex-col items-center justify-center ${mini ? "gap-0.5" : small ? "gap-1.5" : "gap-2"} ${className}`}
      aria-label="Powered by Verkkutech"
    >
      <p
        className={
          mini
            ? "text-[7px] font-medium uppercase tracking-[0.18em] text-zinc-600"
            : compact
              ? "text-[9px] font-medium uppercase tracking-[0.22em] text-zinc-500"
              : "text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500"
        }
      >
        Powered by
      </p>
      <img
        src="/branding/verkku-logo.svg"
        alt="Verkkutech"
        className={
          mini
            ? "h-4 w-auto max-w-[5.5rem] object-contain opacity-90"
            : compact
              ? "h-7 w-auto max-w-[9.5rem] object-contain opacity-95"
              : "h-9 w-auto max-w-[12rem] object-contain opacity-95 sm:h-10 sm:max-w-[14rem]"
        }
      />
    </div>
  );
}
