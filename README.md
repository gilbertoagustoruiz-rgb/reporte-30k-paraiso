# Reporte 30K Paraíso

Dashboard web del reporte 30K de la cuenta Paraíso (Below Trade): venta mensual por punto de venta, estructura de promotoría por marca y alertas de tiendas con promedio mensual bajo S/ 30,000.

## Uso
1. Abre el sitio y pulsa **Subir datos**.
2. Carga los Excel (.xlsx/.xls) o CSV de venta anual. La página detecta las columnas (punto de venta, fecha o año/mes, venta) y permite ajustar el mapeo.
3. Pulsa **Agregar al reporte**. Los datos se procesan en el navegador y quedan guardados en ese navegador (localStorage); no se envían a ningún servidor.

## Estructura del repositorio
- `public/index.html` — el sitio publicado (autocontenido; usa SheetJS desde cdnjs).
- `src/template.html` — código fuente de la página.
- `src/estructura.json` — estructura de promotoría 2026 (fuente: Google Sheet «ESTRUCTURA PROMOTORIA 2026»).
- `build.py` — regenera `public/index.html`: `python3 build.py`.

## Despliegue
Sitio estático en Render: publish path `public`, sin paso de compilación.

## Alertas
- **< a 30K**: promedio mensual del año de referencia bajo el umbral (configurable).
- **Alertas + Promotoría**: bajo el umbral y con promotor Paraíso asignado.
- Promedio = total del año ÷ meses con venta registrada.
