# Integración de métricas web — pendiente de accesos

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
