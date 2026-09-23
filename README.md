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

- **General:** ventas confirmadas, ticket promedio, órdenes y prendas; el flujo CRM se presenta en una sección separada.
- **Vendedora comercial:** agrega oportunidades ganadas y porcentaje de oportunidades ganadas.
- **Web (Tiendanube), como vendedora o canal:** muestra indicadores comerciales y oculta todo el bloque CRM. Se mantiene compatibilidad con la cuenta antigua `Yeni`.
- **Canal seleccionado:** el dataset CRM actual no contiene canal. Sus indicadores se ocultan para no presentar totales sin filtrar; en venta directa se indica cómo volver a consultarlos por vendedora.

El porcentaje del CRM es `ganadas / (ganadas + perdidas)`. Se mantiene el criterio temporal previo: fecha de cierre, o fecha de alta como referencia si falta el cierre. El KPI muestra solamente la fórmula; la ayuda del indicador y de la comparativa informa los registros que usan la alternativa de fecha. Esto no representa una fecha real de cierre y puede alterar la distribución mensual. Las filas sin estado identificable se excluyen y se informan en la ayuda, sin ocultar los resultados conocidos ni contarlas como pérdidas. No es conversión de visitas a compras. Sin cierres se muestra «Sin cierres». Las oportunidades siguen visibles cuando no hay ventas.

La extracción actual determina ganadas por `crm.stage.is_won` (con fallback al nombre si no obtiene la etapa) y perdidas por `active=false` cuando no son ganadas. Conviene validar con el equipo comercial si todas las archivadas representan pérdidas y si las etapas marcadas `is_won` corresponden al criterio acordado.

### Flujo de etapas de Odoo

El flujo cuenta **oportunidades creadas en el período seleccionado, por su etapa actual**, respetando la vendedora elegida. Muestra las activas por etapa y agrega las archivadas sin ganar como **Perdidas**, sin duplicarlas en su etapa anterior. Excluye leads y las demás archivadas (incluidas las ganadas archivadas). No reconstruye la etapa que tenían en una fecha pasada. Las etapas sin oportunidades se conservan en cero y las nuevas etapas se incorporan con su nombre y orden de Odoo.

- **Contacto inicial:** Nueva consulta + Contactado.
- **En gestión:** Cotización enviada + Negociación.
- **Pedido confirmado** y **Ganado** se mantienen separados, aunque la configuración `is_won` de Odoo pudiera marcar ambos.
- **No avanzará:** solo la etapa NO AVANZARA, sin reclasificar como tales todas las archivadas.
- **Perdidas:** oportunidades clasificadas como perdidas por el backend (archivadas sin ganar).

Las tarjetas agrupadas muestran también el conteo de sus etapas originales. Cada grupo muestra su porcentaje sobre el total de oportunidades incluido en el flujo (puede haber diferencias de redondeo). El porcentaje comercial de las tarjetas superiores mantiene su propia base temporal (cierre o alta como referencia), indicada en su ayuda.

El flujo aparece inmediatamente debajo de los KPIs principales. En Dirección, al elegir todas las vendedoras y todos los canales, se muestra además la comparativa de ganadas, perdidas, cierres y porcentaje ganado. No exige un mínimo de cierres ni limita el número de vendedoras; excluye cuentas Web y sin asignar. El total de la comparativa agrega solo las vendedoras incluidas y calcula el porcentaje sobre la suma de cierres, no promediando porcentajes individuales.

Las tablas de evolución mensual se presentan cerradas por defecto y se expanden con «Detalle mes a mes». Los gráficos y la tabla comparativa del CRM permanecen visibles.

No se muestran las secciones pendientes de industria o tamaño del cliente. La comparación interanual aparece solo si el filtro contiene ventas de al menos dos años. Las secciones visibles se numeran automáticamente, sin saltos, según el rol y los filtros.

Apps Script agrega `C[11]` con el flag activo (`1`) / archivado (`0`), independiente de ganado. Los datasets previos se admiten durante la resincronización con un aviso de compatibilidad. El cambio desplegado del backend se conserva como parche en [backend/crm-active.patch](backend/crm-active.patch); no contiene credenciales.

## Verificación

`python tests/test_dashboard.py` ejecuta las regresiones en Chromium con API y datos sintéticos. Requiere Python, Playwright y su navegador Chromium (`python -m pip install playwright` y `python -m playwright install chromium`). No inicia sesión ni consulta datos productivos.

La integración de visitas y las dependencias pendientes se describen en [docs/integracion-tiendanube.md](docs/integracion-tiendanube.md).

Desarrollado por [Calcuta Consulting](https://calcutaconsulting.com).
# Moneda de los objetivos

El selector ARS/USD también convierte objetivos, ventas del mes y saldo pendiente, tanto para Dirección como para cada vendedora. Los tres usan la misma referencia (promedio oficial del mes, o cotización actual si no hay promedio); el porcentaje de cumplimiento se calcula en ARS y permanece estable. Las ventas del resto del tablero conservan su conversión histórica por día, con promedio mensual como respaldo.

Configuración muestra y permite editar objetivos en la moneda seleccionada. Los objetivos se guardan siempre en ARS; cambiar de moneda conserva el borrador y no modifica los valores guardados. Sin cotización, se indica la falta del dato y se bloquea la edición en USD.

## Perfil de vendedora

Muestra sus KPI y objetivo, evolución mensual de ventas con detalle colapsado, flujo de oportunidades, prendas vendidas, ticket promedio, provincias y tipos de producto. Conserva fecha, ARS/USD, PDF y Excel. No muestra configuración, rankings, comparativas entre personas, canales ni comparativo interanual.

Apps Script limita los registros de órdenes, líneas, entregas y CRM por la identidad del token, y entrega únicamente el objetivo propio. Excel aplica el mismo recorte antes de exportar. El selector del navegador no determina los permisos. Las pruebas `node tests/backend_permissions.cjs <directorio-backend>` usan datos sintéticos sobre las funciones del backend descargado; incluyen intentos de cambiar vendedora/rol desde la petición y operaciones administrativas denegadas.
