import s from "./echodevice.module.css";

/**
 * An Echo Show 8 drawn in CSS: screen in a black bezel, fabric-wrapped speaker body behind it, sitting
 * on a counter that catches the glow of the screen.
 */
export default function EchoDevice({
  children,
  glow = true,
  dark = false,
  className,
}: {
  children: React.ReactNode;
  glow?: boolean;
  /** On a night band: a lit rim and the screen's glow instead of a floor shadow. */
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={`${s.stage} ${dark ? s.onDark : ""} ${className ?? ""}`}>
      <div className={s.device}>
        <div className={s.body} aria-hidden />
        <div className={s.bezel}>
          <span className={s.camera} aria-hidden />
          <div className={s.screen}>{children}</div>
        </div>
      </div>
      <div className={s.counter} aria-hidden>
        {glow && <span className={s.spill} />}
      </div>
    </div>
  );
}
