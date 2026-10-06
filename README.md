# Zaphira — KPIs de Ventas

Tablero de KPIs de ventas de Zaphira, publicado en Cloudflare Workers en
[zaphira-ventas-calcuta.agustin-5e6.workers.dev](https://zaphira-ventas-calcuta.agustin-5e6.workers.dev/).
El enlace anterior de GitHub Pages continúa funcionando y consulta la misma API de Cloudflare.

- **Página:** `index.html` — renderiza y agrega todo client-side (filtros, ARS/USD, export).
- **Acceso:** cada vendedora entra con su usuario y ve **sólo sus ventas**; Dirección ve todo y administra los accesos desde Configuración. El login lo valida el backend, no el navegador: acá no hay ninguna contraseña ni hash.
- **Datos:** se piden por POST al Worker (`{op:'data', token}`), que los devuelve **ya recortados por vendedora** y sincroniza con Odoo cada 30 min. Acá no hay credenciales ni datos versionados.
- **Export XLSX:** lo genera el mismo backend (`{op:'xlsx', token, …}`), también recortado.

El backend vive en [`api-worker`](api-worker/). `node api-worker/build.mjs && wrangler deploy --config api-worker/wrangler.jsonc`
publica la página, la API y el cron juntos. El acceso existente se migró conservando los hashes,
las sales y el secreto de sesión; las usuarias mantienen usuario y contraseña.

## Fuentes y almacenamiento

Migrado desde Apps Script el 06/10/2026:

- Odoo aporta las órdenes confirmadas (`sale`/`done`), líneas y oportunidades del CRM.
- Cloudflare D1 guarda usuarios, objetivos y el dataset compacto; la cotización histórica se guarda allí como caché.
- Las credenciales de Odoo, Tiendanube y la firma de sesiones viven como secretos del Worker, fuera del repositorio.
- Google Sheets y Apps Script quedan como archivo histórico del tablero. `Postventa.gs` es un proceso separado que alimenta la planilla de incidencias de Denise y no forma parte de esta API.
- El dataset ocupa cerca de 0,5 MB. Una actualización escribe aproximadamente 60 fragmentos cada 30 minutos y cada carga lee esos fragmentos; no hace falta Neon para este volumen.

## Indicadores según los filtros

- **General:** ventas confirmadas, ticket promedio, órdenes y prendas; el flujo CRM se presenta en una sección separada.
- **Vendedora comercial:** agrega oportunidades ganadas y porcentaje de oportunidades ganadas.
- **Tiendanube:** es una vista propia al elegir **Canal → Tiendanube**. En **Vendedora** no aparece Tiendanube ni la cuenta técnica Web/`Yeni`. Usa la API de TN para sus pedidos, pagos, ticket, productos y abandonos. No agrega esos pedidos al consolidado Odoo. La cuenta técnica Web/`Yeni` ya no aparece como otra opción de vendedora; sus registros de Odoo siguen dentro del consolidado. Con Canal = Todos y Vendedora = Todas, el consolidado conserva todas las ventas de Odoo, incluidas las web. La vista del canal Tiendanube no muestra CRM comercial.
- **Canal seleccionado:** el dataset CRM actual no contiene canal. Sus indicadores se ocultan para no presentar totales sin filtrar; en venta directa se indica cómo volver a consultarlos por vendedora. Venta directa abre en Año en curso si no se eligió manualmente otro período; los meses sin órdenes dentro de la cobertura de Odoo se muestran en cero. El promedio de prendas por orden usa el mismo numerador del KPI de prendas. El cruce de segmentos de producto por provincia requiere la provincia de cada línea, incorporada al backend.

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

El dataset agrega `C[11]` con el flag activo (`1`) / archivado (`0`), independiente de ganado. Los datasets previos se admiten durante la resincronización con un aviso de compatibilidad. El cambio histórico se conserva como parche en [backend/crm-active.patch](backend/crm-active.patch); no contiene credenciales.

## Verificación

`python tests/test_dashboard.py` ejecuta las regresiones en Chromium con API y datos sintéticos. Requiere Python, Playwright y su navegador Chromium (`python -m pip install playwright` y `python -m playwright install chromium`). No inicia sesión ni consulta datos productivos.
`node --test tests/api_transport.cjs tests/sales_api_worker.mjs` verifica transporte, sesiones, permisos y Excel.

La integración de visitas y las dependencias pendientes se describen en [docs/integracion-tiendanube.md](docs/integracion-tiendanube.md).

Desarrollado por [Calcuta Consulting](https://calcutaconsulting.com).
# Moneda de los objetivos

El selector ARS/USD también convierte objetivos, ventas del mes y saldo pendiente, tanto para Dirección como para cada vendedora. Los tres usan la misma referencia (promedio oficial del mes, o cotización actual si no hay promedio); el porcentaje de cumplimiento se calcula en ARS y permanece estable. Las ventas del resto del tablero conservan su conversión histórica por día, con promedio mensual como respaldo.

Configuración muestra y permite editar objetivos en la moneda seleccionada. Los objetivos se guardan siempre en ARS; cambiar de moneda conserva el borrador y no modifica los valores guardados. Sin cotización, se indica la falta del dato y se bloquea la edición en USD.

El filtro de período carga los objetivos de los meses seleccionados. Cada mes compara sus ventas filtradas con su objetivo mensual completo y usa su propia cotización de referencia. Los rangos de varios meses muestran el cumplimiento por mes. Configuración conserva los meses históricos desde enero de 2026 (o antes si hay datos), incluidos meses sin ventas, y permite cargar los tres próximos meses.

## Perfil de vendedora

Muestra sus KPI y objetivo, evolución mensual de ventas con detalle colapsado, flujo de oportunidades, prendas vendidas, ticket promedio, provincias y tipos de producto. Conserva fecha, ARS/USD, PDF y Excel. No muestra configuración, rankings, comparativas entre personas, canales ni comparativo interanual.

El Worker limita los registros de órdenes, líneas, entregas y CRM por la identidad del token, y entrega únicamente el objetivo propio. Excel aplica el mismo recorte antes de exportar. El selector del navegador no determina los permisos. La prueba histórica `node tests/backend_permissions.cjs <directorio-backend>` sigue cubriendo el backend anterior con datos sintéticos.

## Tiendanube

Dirección elige **Tiendanube** en el selector **Canal**, visible también en móvil sin abrir los filtros. Los filtros conservan el orden **Moneda → Canal → Vendedora → Período**. General y Tiendanube abren en **Mes actual**; Venta directa abre en **Año en curso**. El filtro Tiendanube permite consultar desde enero de 2026 sin quedar limitado por el corte de Odoo en marzo. Las selecciones manuales se conservan por fuente al alternar durante la sesión y se restablecen al recargar. Las semanas van de lunes a domingo, con extremos parciales. El gráfico de pedidos pagados muestra el importe abreviado en las barras, la cantidad en la línea y la variación frente al período anterior debajo de cada período; la tabla desplegable conserva los importes exactos. Otro gráfico muestra ticket y unidades promedio por mes y por semana, a partir de las unidades pagadas diarias del backend.

El desglose de cupones y descuentos identifica el pedido, el código de cupón cuando la API lo entrega y los importes de descuento. Un descuento sin cupón se identifica como tal; si Tiendanube no permite recuperar el código, se muestra el ID del cupón y se indica que el código no está disponible. No se envían datos de compradores al navegador. Los orígenes explican qué significa Tienda y Creación manual; Mobile conserva el valor de Tiendanube sin atribuirle un dispositivo no documentado.

La vista cuenta con pedidos, importes pagados, ticket, unidades por pedido, evolución, estados y orígenes, ranking de productos y checkouts abandonados. Suma descuentos aplicados, pedidos con descuento/cupón, medios de pago y estado de envío de los pedidos pagados; el indicador de envío pendiente o parcial describe estados actuales, no demoras frente a fechas prometidas. El ranking es por unidades de producto, no por prendas componentes de conjuntos. Oculta los objetivos de vendedoras y no suma datos de TN al consolidado de Odoo. Consulta al abrir/cambiar el período y reutiliza agregados hasta 5 minutos. Visitas y comportamiento quedan pendientes de integración, con enlace al panel nativo de TN; GA4 es una alternativa de automatización.

El módulo [`api-worker/tiendanube.mjs`](api-worker/tiendanube.mjs) usa `TN_ACCESS_TOKEN` como secreto de Cloudflare. [Definiciones y cobertura](docs/integracion-tiendanube.md). La prueba histórica del cálculo anterior sigue en `node --test tests/tiendanube.cjs`.
