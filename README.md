# Zaphira — KPIs de Ventas

Frontend estático (GitHub Pages) del tablero de KPIs de ventas de Zaphira.

- **Página:** `index.html` — renderiza y agrega todo client-side (filtros, ARS/USD, export).
- **Acceso:** cada vendedora entra con su usuario y ve **sólo sus ventas**; Dirección ve todo y administra los accesos desde Configuración. El login lo valida el backend, no el navegador: acá no hay ninguna contraseña ni hash.
- **Datos:** se piden por POST al backend en Google Apps Script (`{op:'data', token}`), que los devuelve **ya recortados por vendedora** y sincroniza con Odoo cada 30 min. Acá no hay credenciales ni datos versionados.
- **Export XLSX:** lo genera el mismo backend (`{op:'xlsx', token, …}`), también recortado.

El código fuente del backend vive en el proyecto Apps Script (repo/carpeta `appscript-zaphira`, se deploya con `clasp`).
- **Mantenimiento:** `mantenimiento/` guarda scripts sueltos que van pegados en ese proyecto Apps Script, no acá (ej. `alta-direccion.gs`, para dar de alta o resetear un usuario sin entrar al tablero como Dirección).

Desarrollado por [Calcuta Consulting](https://calcutaconsulting.com).
