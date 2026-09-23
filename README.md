# Zaphira — KPIs de Ventas

Frontend estático (GitHub Pages) del tablero de KPIs de ventas de Zaphira.

- **Página:** `index.html` — renderiza y agrega todo client-side (filtros, ARS/USD, export).
- **Acceso:** cada vendedora entra con su usuario y ve **sólo sus ventas**; Dirección ve todo y administra los accesos desde Configuración. El login lo valida el backend, no el navegador: acá no hay ninguna contraseña ni hash.
- **Datos:** se piden por POST al backend en Google Apps Script (`{op:'data', token}`), que los devuelve **ya recortados por vendedora** y sincroniza con Odoo cada 30 min. Acá no hay credenciales ni datos versionados.
- **Export XLSX:** lo genera el mismo backend (`{op:'xlsx', token, …}`), también recortado.

El código fuente del backend vive en el proyecto Apps Script (repo/carpeta `appscript-zaphira`, se deploya con `clasp`).

## Fuentes y almacenamiento

Verificado en el proyecto Apps Script el 23/09/2026:

- Odoo aporta las órdenes confirmadas (`sale`/`done`), líneas y oportunidades del CRM.
- Google Sheets guarda las tablas de auditoría, usuarios, objetivos y cotizaciones.
- El dataset compacto que consume el dashboard se guarda en fragmentos dentro de Script Properties. Las credenciales de Odoo también viven en propiedades privadas; no deben incorporarse a este repositorio.
- Este flujo no utiliza Neon ni Cloudflare.

## Indicadores según los filtros

- **General:** ventas confirmadas, ticket promedio, órdenes y prendas; el CRM se explica en una sección separada.
- **Vendedora comercial:** agrega oportunidades ganadas y porcentaje de oportunidades ganadas.
- **Web (Tiendanube), como vendedora o canal:** muestra indicadores comerciales y oculta todo el bloque CRM. Se mantiene compatibilidad con la cuenta antigua `Yeni`.
- **Canal seleccionado:** el dataset CRM actual no contiene canal. Sus indicadores se ocultan para no presentar totales sin filtrar; en venta directa se indica cómo volver a consultarlos por vendedora.

El porcentaje del CRM es `ganadas / (ganadas + perdidas)`, por fecha de cierre. No es conversión de visitas a compras. Sin cierres se muestra «Sin cierres». Con estados o fechas incompletos no se publica un porcentaje ni un total de cierres incompleto, ni se reemplaza la fecha de cierre por la de creación. Las oportunidades siguen visibles cuando no hay ventas.

La extracción actual determina ganadas por `crm.stage.is_won` (con fallback al nombre si no obtiene la etapa) y perdidas por `active=false` cuando no son ganadas. Conviene validar con el equipo comercial si todas las archivadas representan pérdidas y si las etapas marcadas `is_won` corresponden al criterio acordado.

## Verificación

`python tests/test_dashboard.py` ejecuta las regresiones en Chromium con API y datos sintéticos. Requiere Python, Playwright y su navegador Chromium (`python -m pip install playwright` y `python -m playwright install chromium`). No inicia sesión ni consulta datos productivos.

La integración de visitas y las dependencias pendientes se describen en [docs/integracion-tiendanube.md](docs/integracion-tiendanube.md).

Desarrollado por [Calcuta Consulting](https://calcutaconsulting.com).
