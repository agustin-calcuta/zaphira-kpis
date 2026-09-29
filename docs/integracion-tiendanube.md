# Integración Tiendanube y métricas web

## Implementación del 29/09/2026

Tiendanube incorpora una sección **Tienda online**, disponible para Dirección. Odoo continúa como fuente del consolidado comercial y de las ventas de las vendedoras. Las dos fuentes no se suman porque pueden contener el mismo pedido.

- Tienda: `1301166`, `https://tienda.zaphirauniformes.com/` (alias `https://zaphirauniformes.mitiendanube.com/`). Identidad y permisos de lectura verificados mediante `/store`, `/orders` y `/checkouts`.
- Backend: Apps Script existente. Módulo [Tiendanube.gs](../backend/Tiendanube.gs), operación POST `tiendanube` con sesión de Dirección y fechas `from`/`to`.
- Secreto: propiedad privada `TN_ACCESS_TOKEN`. No debe incluirse en código, repositorio, URL, logs ni respuestas del dashboard. Se utiliza la aplicación a medida existente de la tienda.
- Fuente API: `https://api.tiendanube.com/2025-03/1301166`; sólo lecturas.

### Qué muestra y cómo se calcula

| Métrica | Definición |
| --- | --- |
| Pedidos creados | Todos los pedidos creados en el período, incluidos manuales; origen informado por Tiendanube visible por separado |
| Pedidos pagados e importe | Pago completo (`paid`), excluyendo pedidos cancelados; importe `total`, con envío y descuentos; no representa facturación fiscal ni cobros por fecha de acreditación |
| Pendientes | `pending` y `authorized`, sin cancelados |
| Pagos o reembolsos parciales | `partially_paid` y `partially_refunded`, fuera del importe pagado |
| Reembolsados o anulados | `refunded` y `voided`, sin cancelados |
| Unidades y productos | Cantidades de las líneas de pedidos pagados |
| Checkouts abandonados | Disponibles al momento de consultar, creados en el período y sin `completed_at`; cobertura explícita |
| Visitas y comportamiento | Pendientes de integración; TN ofrece su panel y exportación, GA4 es una alternativa; no se muestran como cero |

Las fechas corresponden a la creación del pedido en Argentina; sus estados son los actuales. ARS es la moneda fuente. La conversión a USD reutiliza las cotizaciones históricas del dashboard; ante importes o cotizaciones faltantes no se presenta un total parcial como completo. El origen `mobile` se conserva según Tiendanube, sin inferir el dispositivo del comprador.

### Actualización y cobertura

Esta primera versión **consulta al abrir la sección o cambiar el período**, con reutilización de resultados por hasta 5 minutos. El botón Actualizar vuelve a consultar el backend, sujeto a esa misma caché. No se instaló una sincronización programada ni un histórico persistente de Tiendanube. El proceso de Odoo cada 30 minutos sigue siendo independiente.

La caché guarda únicamente agregados, por rango de fechas y credencial; puede conservar el último resultado hasta 6 horas. Si falla una consulta y aún existe ese resultado, la pantalla lo identifica como desactualizado con su fecha y motivo. La caché puede ser desalojada antes por Apps Script: no equivale a una base histórica.

La consulta sigue todos los enlaces de paginación del mismo recurso/tienda, deduplica IDs y verifica conteos. Tiene límites de 366 días, 10.000 registros y duración; una consulta incompleta devuelve un error, no un total parcial. Los errores 429 y 5xx tienen reintentos acotados.

Los checkouts están disponibles durante los últimos 30 días y pueden tardar hasta 6 horas en aparecer. Sólo incluyen compras que llegaron al segundo paso del checkout; no equivalen a todos los carritos creados. Se omite el día de borde para no informar un día incompleto. Un período anterior se marca sin cobertura; uno parcialmente cubierto muestra el rango efectivo. No se reconstruye un histórico de abandonos ni se infiere recuperación por la desaparición de un checkout.

### Permisos y publicación

El backend verifica la firma de la sesión, el rol y que la cuenta de Dirección siga activa antes de leer credenciales o caché. Devuelve agregados sin correos, domicilios ni otros datos de compradores. Las vendedoras no reciben las métricas globales. No se agregó exportación Excel de Tiendanube.

Para publicar: incorporar `backend/Tiendanube.gs` al proyecto Apps Script y agregar `case 'tiendanube': return opTiendanube_(d);` al dispatcher de `Usuarios.gs`. Actualizar la versión del deployment existente para conservar la URL de la API. El frontend se publica desde `main` en GitHub Pages.

Validación: 34 pruebas de interfaz, 12 pruebas de cálculos/permisos/paginación de Tiendanube y regresiones de aislamiento del backend. Se verificó diseño móvil y conexión real a la API. Las pruebas no contienen credenciales ni datos personales reales.

### Visitas: panel de Tiendanube, exportación y alternativa GA4

Se revisó el administrador autenticado de esta tienda: Estadísticas muestra visitas, comportamiento y conversiones. El menú de cada gráfico permite exportar a CSV o Excel y descargar una imagen. Se confirmó su disponibilidad, sin implementar una importación manual ni usar endpoints privados del panel. La extracción automática sigue pendiente de una vía documentada de TN o, alternativamente, GA4. El dashboard incluye un enlace al panel nativo.

En el HTML público relevado, `LS.store.ga4_measurement_id` estaba vacío y no se detectó un ID `G-…` ni `GTM-…`; sí un píxel de Meta. Eso no descarta una propiedad previa o medición cargada dinámicamente. Falta identificar la propiedad existente y su cuenta administradora.

La API pública de Tiendanube consultada no documenta un recurso de visitas equivalente al panel interno. Como alternativa de actualización automática puede utilizarse GA4 Data API con el **ID numérico de propiedad** y acceso de lectura. El ID de medición `G-…` y el secreto de Measurement Protocol sirven para enviar eventos y no permiten consultar informes.

Antes de mostrar visitas, usuarios o conversión, verificar sesiones y eventos `view_item`, `add_to_cart`, `begin_checkout` y `purchase`, su cobertura y ausencia de duplicados. No es posible reconstruir visitas anteriores a la medición ni prometer igualdad con estadísticas internas de TN.

Como pasos posteriores: persistir observaciones de checkouts si se necesita histórico, añadir sincronización programada/webhooks si hace falta menor demora, y conciliar IDs con Odoo antes de cualquier total combinado. La propuesta inicial de sincronizar cada 30 minutos se pospuso: **no forma parte de esta versión**.

### Fuentes oficiales consultadas

- [API: autenticación, versión, paginación y límites](https://tiendanube.dev/api/getting-started).
- [Aplicaciones a medida y token](https://ayuda.tiendanube.com/es_AR/aplicaciones-a-medida/como-crear-una-aplicacion-a-medida-y-acceder-al-token-en-mi-tiendanube).
- [Pedidos](https://tiendanube.dev/api/resources/2025-03/order).
- [Checkouts abandonados](https://tiendanube.dev/api/resources/2025-03/abandoned-checkout).
- [Integración nativa GA4](https://ayuda.tiendanube.com/es_ES/123490-google-analytics/como-vincular-google-analytics-4-con-mi-tiendanube).
- [Google Analytics Data API](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart).

## Antecedentes del 23/09/2026

Estado al 23/09/2026: cambios del frontend implementados y probados con datos sintéticos. El backend incorpora el flag activo/archivado de cada oportunidad para reflejar el flujo de etapas. No se integraron todavía Tiendanube ni GA4 y no se muestran visitas inventadas o ceros para una fuente desconectada.

## Accesos que faltan

1. **Google Analytics 4:** confirmar si la tienda ya tiene una propiedad, su ID numérico y desde cuándo registra información. Dar a la identidad de integración acceso de lectura (Viewer) a esa propiedad. Comprobar eventos de producto, carrito, checkout y compra; tener GA4 instalado no garantiza que todos estén bien medidos.
2. **Autorización de Google para datos:** el login de Calcuta en Apps Script funciona, pero Google bloqueó el consentimiento al agregar `spreadsheets.readonly` y `analytics.readonly` al cliente de clasp. Configurar un cliente OAuth propio autorizado para esos permisos, revisando las restricciones de Workspace si corresponden, o una cuenta de servicio compartida únicamente con la planilla y la propiedad GA4. No repetir ni intentar eludir la pantalla de bloqueo. Guardar credenciales fuera del repositorio.
3. **Tiendanube:** acceso a la tienda para autorizar una aplicación con los permisos de lectura necesarios, obteniendo `store_id` y un token OAuth por un canal seguro. El login del administrador no equivale a tener autorización API. Evitar copiar contraseñas o tokens en issues, commits o documentación pública.
4. **Criterio comercial:** confirmar con Julián qué etapas significan una oportunidad ganada, si toda oportunidad archivada es perdida, y cuál es el campo real de canal del CRM. No inferir canal a partir del vendedor ni solo de pedidos vinculados: excluiría oportunidades perdidas sin pedido.

## Trabajo que sigue cuando estén habilitados

| Fuente | Métricas | Condición |
|---|---|---|
| Odoo | Ventas confirmadas, órdenes, ticket y prendas | Mantener la fuente comercial existente |
| GA4 | Sesiones, usuarios, vistas de productos, eventos de carrito y checkout | Validar propiedad, medición, cobertura histórica y permisos |
| Tiendanube | Pedidos creados, pagos, cancelaciones y checkouts abandonados | Autorizar la app y verificar campos y estados reales |

Implementar las consultas y credenciales en el backend. Devolver al navegador únicamente agregados autorizados, junto con fuente, última actualización, cobertura y estado de disponibilidad. Respetar el recorte por rol existente; la vista de una vendedora no debe recibir métricas globales de la tienda.

La vista Web seguirá sin la tasa de conversión comercial. La primera incorporación será visitas junto con ventas, órdenes y ticket; después se podrá agregar un bloque de comportamiento con productos vistos, carritos y checkout cuando los eventos estén validados.

## Reglas de conciliación

- No sumar ventas de Odoo y Tiendanube: pueden representar los mismos pedidos. Conciliar por el identificador de pedido que efectivamente conserve la integración.
- Diferenciar pedido creado, pago aprobado y orden confirmada. Alinear período, zona horaria, IVA, envío, descuentos, cancelaciones y devoluciones antes de comparar importes.
- Identificar sesiones, usuarios y vistas como métricas distintas. No sumar usuarios únicos diarios para obtener usuarios únicos del período.
- No prometer igualdad entre GA4 y las estadísticas internas de Tiendanube: fuentes, consentimiento y definiciones pueden diferir.
- La API pública documentada de Tiendanube no ofrece en el catálogo consultado un recurso de visitas. Verificar con soporte si existe una exportación o integración habilitada para esta tienda antes de prometer reproducir su panel interno.
- Los checkouts abandonados consultables tienen una ventana de 30 días. No equivalen a todos los carritos creados ni permiten reconstruir por sí solos el histórico.
- No reconstruir visitas anteriores a la instalación de la medición. Mostrar sin datos cuando no exista cobertura, distinguiéndolo de cero visitas.

## Referencias

- [Autorización y recursos de la API de Tiendanube](https://tiendanube.github.io/api-documentation/v1/intro)
- [Pedidos](https://tiendanube.github.io/api-documentation/resources/order)
- [Checkouts abandonados](https://tiendanube.github.io/api-documentation/resources/abandoned-checkout)
- [Google Analytics Data API](https://developers.google.com/analytics/devguides/reporting/data/v1)
