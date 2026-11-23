# Reporte 30K Paraíso

Dashboard web del reporte 30K de la cuenta Paraíso (Below Trade): venta mensual por punto de venta, estructura de promotoría por marca y alertas de tiendas con promedio mensual bajo S/ 30,000.

## Uso
1. Abre el sitio y pulsa **Subir datos**.
2. Carga los Excel (.xlsx/.xls/.xlsb) o CSV de venta anual. La página detecta las columnas (PDV, AÑO/MES o FECHA, PRECIO TOTAL o VENTA, MARCA, TIPO) y permite ajustar el mapeo.
   Por defecto solo suma las marcas Paraíso, Krea, Komfort, Viva Home y Casa Joven (columna MARCA) y solo las filas COBERTURADO o COBERTURADOS (columna COBERTURA); se puede cambiar en la revisión.
3. Pulsa **Agregar al reporte**. Los datos se procesan en el navegador y quedan guardados en ese navegador (localStorage); no se envían a ningún servidor.

## Descargas
- **Descargar ventas (año en curso)**: Excel con las ventas mes a mes, total, promedio y alertas por tienda del año actual (según la fecha del sistema), sin importar el año elegido en pantalla. Respeta los filtros de cadena, búsqueda, cargo y estado. Incluye una hoja de resumen por cadena.
- **Descargar Excel**: la tabla tal como se ve en pantalla.

## Estructura del repositorio
- `public/index.html` — el sitio publicado (autocontenido; usa SheetJS desde cdnjs).
- `src/template.html` — código fuente de la página.
- `src/estructura.json` — estructura de promotoría 2026 (fuente: Google Sheet «ESTRUCTURA PROMOTORIA 2026»).
- `build.py` — regenera `public/index.html`: `python3 build.py`.

## Despliegue
Sitio estático en Render: publish path `public`, sin paso de compilación.

## Alertas
- **< a 30K**: promedio mensual del año de referencia bajo el umbral (configurable).
- **Alertas + Promotoría**: ALERTA si alguna marca de la competencia (El Cisne, Drimer, Forli, Rosen, Drom, Simmons, Technodream, Serta o Rizzoli) tiene más promotores que Paraíso en la tienda; si no, OK.
- Promedio = total del año ÷ meses con venta registrada.
