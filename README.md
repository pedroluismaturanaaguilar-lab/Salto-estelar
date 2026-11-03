# Salto Estelar

Juego web de plataformas con 100 niveles, palabras coleccionables, munición, llaves, cofres, tienda, perfiles y salas cooperativas en línea.

## Desarrollo local

Requiere Node.js 20 o superior.

```cmd
npm install
npm start
```

El servidor elige un puerto libre entre 3006 y 3100. Abre la dirección que imprime. Las cuentas de desarrollo se guardan en `data/salto-estelar.json`; esa carpeta está ignorada por Git. Consulta [GUIA_EJECUTAR_CMD.txt](GUIA_EJECUTAR_CMD.txt).

## Cuentas y base de datos

Si `DATABASE_URL` está configurada, el servidor guarda cuentas, monedas, inventario, progreso y partidas en PostgreSQL. Sin esa variable usa el JSON local, apropiado para desarrollo en una sola computadora.

El Blueprint de `render.yaml` crea una base PostgreSQL gratuita para probar y conecta automáticamente el servicio. Según las [limitaciones actuales del plan gratuito de Render](https://render.com/docs/free), esas bases vencen a los 30 días y el servicio web gratuito no conserva archivos locales. Para guardar progreso de jugadores a largo plazo, actualiza la base a un plan que no expire en el panel de Render.

## Multijugador y llamadas

Las salas privadas son de dos jugadores y usan WebSockets; posiciones, avance de nivel, coleccionables, chat y marcador de tiro se comparten en tiempo real. Las llamadas usan WebRTC con servidores STUN públicos. En algunas redes con NAT restrictivo se necesita configurar un servidor TURN para que audio/vídeo conecte siempre; ese proveedor y sus credenciales no se incluyen.

Las llamadas requieren HTTPS (Render sirve HTTPS) y permiso del navegador para cámara/micrófono. El juego individual y las mecánicas básicas funcionan sin cuenta; para respaldar el progreso entre dispositivos, crea una cuenta.

## Ejecutar verificaciones

```cmd
npm test
```

Las pruebas crean cuentas de prueba en un directorio temporal y verifican recompensas idempotentes, persistencia local, 100 palabras, creación y unión de salas, sincronización de posiciones, eventos únicos y chat.

## Android

La carpeta `app/` contiene el proyecto fuente Android. Abre `app/` en Android Studio (API mínima 33) y compila un APK para instalarlo directamente. La app carga primero la web HTTPS para habilitar cuentas y juego en línea; sin conexión, abre la copia local incluida y funciona en modo individual.

## Despliegue

Conecta el repositorio con Render como Blueprint para aplicar `render.yaml`. El servicio inicia con `npm start` y ofrece `/health`. Las actualizaciones a `main` pueden activar el auto despliegue si el servicio está vinculado a esa rama.
