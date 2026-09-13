/**
 * AuraBackground — the signature liquid glass ambient background.
 *
 * Renders four soft radial gradient blobs behind everything. The colours
 * come from CSS variables in globals.css so the aura recolours itself
 * when the light / dark theme changes. Mount this once at the app layout,
 * behind the content, and every glass card in the tree will read against it.
 */
export function AuraBackground() {
  return <div className="aura" aria-hidden="true" />;
}
