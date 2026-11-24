# Reporte 30K Paraíso

Dashboard web del reporte 30K de la cuenta Paraíso (Below Trade): venta mensual por punto de venta, estructura de promotoría por marca y alertas de tiendas con promedio mensual bajo S/ 30,000.

## Uso
1. Abre el sitio y pulsa **Subir datos**.
2. Carga los Excel (.xlsx/.xls/.xlsb) o CSV de venta anual. La página detecta las columnas (PDV, AÑO/MES o FECHA, PRECIO TOTAL o VENTA, MARCA, TIPO) y permite ajustar el mapeo.
   Por defecto solo suma las marcas Paraíso, Krea, Komfort, Viva Home y Casa Joven (columna MARCA) y solo las filas COBERTURADO o COBERTURADOS (columna COBERTURA); se puede cambiar en la revisión.
3. Pulsa **Agregar al reporte**. El Excel se procesa en el navegador y solo se envía al servidor el resumen por tienda y mes, que queda guardado en Postgres: todos los que abren el sitio ven lo mismo.

Ver el reporte es libre. Para subir, reemplazar o quitar archivos hay que entrar en **🔒 Editar** con la contraseña del servidor (variable `UPLOAD_PASSWORD`).

## Módulos
La página tiene tres pestañas (enlazables con `#radar`, `#detalle-30k`, `#datos`):
- **Radar de tiendas críticas** (portada).
- **Detalle a 30K**: indicadores, resumen por cadena, filtros, tabla por punto de venta y descargas.
- **Datos del reporte**: carga de archivos de venta y de estructura.

Cadena, año y umbral se comparten entre el radar y el detalle; los demás filtros del detalle no afectan al radar.

## Radar de tiendas críticas
Panel superior para evaluar tiendas críticas (año de referencia, venta Paraíso):
- Cifras clave: tiendas bajo el umbral, brecha mensual para llegar a 30K, «zona roja» (bajo 30K + alerta de promotoría) y participación Paraíso.
- Semáforo: Crítica (< 50% del umbral), En riesgo (50–100%), Saludable (≥ umbral), Sin venta.
- Gráficos: tiendas bajo 30K mes a mes (mes en curso rayado), venta Paraíso vs competencia, cadenas por estado y cuadrante venta vs participación.
- Top 15 tiendas más críticas con avance al umbral, tendencia, promotores y alertas; clic para ver la tienda en la tabla.

## Ventas de competencia
Al subir un archivo se elige **«Todas las marcas»** (grupo Paraíso + competencia) o **«Solo marcas Paraíso»** (Paraíso, Krea, Komfort, Viva Home, Casa Joven; el resto no se guarda). La elección queda registrada en la lista de archivos.

Las filas cuya MARCA no pertenece al grupo Paraíso (Paraíso, Casa Joven, Viva Home, Krea, Komfort) se guardan como **venta de competencia**. El selector «Ventas de» cambia la tabla entre el grupo Paraíso y la competencia. Las alertas (< a 30K y promotoría) siempre usan la venta Paraíso.

## Descargas
- **Descargar ventas (año en curso)**: Excel con las ventas mes a mes, total, promedio y alertas por tienda del año actual (según la fecha del sistema), sin importar el año elegido en pantalla. Respeta los filtros de cadena, búsqueda, cargo y estado. Incluye una hoja de resumen por cadena (con participación Paraíso vs competencia) y una hoja «Competencia» con la venta mensual de las demás marcas por tienda.
- **Descargar Excel**: la tabla tal como se ve en pantalla.

## Estructura del repositorio
- `public/index.html` — el sitio publicado (autocontenido; usa SheetJS desde cdnjs).
- `src/template.html` — código fuente de la página.
- `src/estructura.json` — estructura de promotoría 2026 (fuente: Google Sheet «ESTRUCTURA PROMOTORIA 2026»).
- `build.py` — regenera `public/index.html`: `python3 build.py`.
- `server.js` / `package.json` — servidor Express + Postgres.

## Despliegue (Render)
- **Sitio** `reporte-30k-paraiso` (estático, publish path `public`): https://reporte-30k-paraiso.onrender.com
- **Servidor** `reporte-30k-paraiso-api` (Node, `node server.js`): API `/api/*` y la misma página. Variables de entorno:
  - `DATABASE_URL`: *Internal Database URL* de la base Postgres (tablas `r30k_files` y `r30k_config`, se crean solas).
  - `UPLOAD_PASSWORD`: contraseña para subir/quitar.
  - `ALLOWED_ORIGINS` (opcional): orígenes permitidos; por defecto el sitio estático.

## Alertas
- **< a 30K**: promedio mensual del año de referencia bajo el umbral (configurable).
- **Alertas + Promotoría**: ALERTA si alguna marca de la competencia (El Cisne, Drimer, Forli, Rosen, Drom, Simmons, Technodream, Serta o Rizzoli) tiene más promotores que Paraíso en la tienda; si no, OK.
- Promedio = total del año ÷ meses con venta registrada.
