import { toolButton } from './Controls.mjs';

// Shared popup anatomy: compact title strip, scrollable body, right-aligned actions.
export function styleDialog(dialog) {
  const container = dialog.querySelector('form') || dialog;
  const title = container.querySelector('h2'), actions = container.querySelector('.dialog-actions');
  dialog.classList.add('app-dialog'); container.classList.add('dialog-layout');
  title.id ||= `${dialog.id}-title`; dialog.setAttribute('aria-labelledby', title.id);
  const header = document.createElement('div'); header.className = 'dialog-titlebar'; header.append(title);
  header.insertAdjacentHTML('beforeend', toolButton({ label: 'Close dialog', icon: 'x', attributes: 'type="button" class="dialog-close"' }));
  header.lastElementChild.onclick = () => dialog.close();
  const body = document.createElement('div'); body.className = 'dialog-body';
  for (const child of [...container.childNodes]) if (child !== actions) body.append(child);
  if (actions) { const primary = actions.querySelector('.primary'); if (primary) actions.append(primary); }
  container.replaceChildren(header, body, ...(actions ? [actions] : []));
}
