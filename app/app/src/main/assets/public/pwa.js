let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  const button = document.getElementById('btnInstall');
  if (button) button.hidden = false;
});
window.addEventListener('appinstalled', () => {
  const button = document.getElementById('btnInstall');
  if (button) button.hidden = true;
  installPrompt = null;
});
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('btnInstall');
  if (button) button.addEventListener('click', async () => {
    if (!installPrompt) {
      alert('Para instalar: abre el menú del navegador y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.');
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/service-worker.js').catch(error => console.warn('No se pudo activar el modo instalable:', error));
  }
});

