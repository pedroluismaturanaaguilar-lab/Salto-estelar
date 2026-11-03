# Salto Estelar

Juego web de plataformas con servidor Node.js sin dependencias externas y proyecto Android Studio en `app/`.

## Ejecutar localmente

Requiere Node.js 20 o superior.

```cmd
npm start
```

El servidor busca automáticamente un puerto libre desde 3006 hasta 3100 e imprime la dirección exacta al iniciarse. Abre esa dirección en el navegador. Consulta [GUIA_EJECUTAR_CMD.txt](GUIA_EJECUTAR_CMD.txt) para teléfono por Wi-Fi y generación de APK.

## Desplegar en Render

Conecta el repositorio a Render como Blueprint (usará `render.yaml`) o crea un Web Service Node. Comando de inicio: `npm start`; el servidor respeta la variable `PORT` de Render. La URL HTTPS se puede instalar como PWA desde Android Chrome o iOS Safari.

## Android

La carpeta `app/` incluye una copia del juego y un proyecto Android Studio. Abre esa carpeta en Android Studio, instala Android SDK Platform 35 si lo pide y usa Build > Build APK(s). El APK debug se puede compartir e instalar directamente, sin Play Store. Instrucciones completas en [app/LEEME_ANDROID.txt](app/LEEME_ANDROID.txt).

El juego contiene 100 niveles generados proceduralmente. El récord se guarda localmente en el dispositivo. Las cuentas, sincronización entre dispositivos, modo multijugador y servicios de base de datos todavía no están implementados.
