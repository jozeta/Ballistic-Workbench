/**
 * Ballistic Workbench - user feedback (toasts) via Låda Glass, with a console fallback when the
 * design system's script is not loaded (Node tests). Never use alert(): it blocks the page.
 */

export function toast(title, type = 'info', description = '') {
  if (typeof LadaGlass !== 'undefined' && LadaGlass.toast) {
    return LadaGlass.toast(title, { type, description: description || undefined });
  }
  console.log(`[${type}] ${title}${description ? ` ${description}` : ''}`);
  return null;
}
