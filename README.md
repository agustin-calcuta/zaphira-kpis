# Zaphira — KPIs de Ventas

Frontend estático (GitHub Pages) del tablero de KPIs de ventas de Zaphira.

- **Página:** `index.html` — renderiza y agrega todo client-side (filtros, ARS/USD, export).
- **Datos:** se fetchean en runtime del backend en Google Apps Script (`?data=1`), que sincroniza con Odoo cada 30 min. Acá no hay credenciales ni datos versionados.
- **Export XLSX:** lo genera el mismo backend (`?xlsx=1&...`).

El código fuente del backend vive en el proyecto Apps Script (repo/carpeta `appscript-zaphira`, se deploya con `clasp`).

Desarrollado por [Calcuta Consulting](https://calcutaconsulting.com).
