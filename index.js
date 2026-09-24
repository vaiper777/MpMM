const express = require("express");
const cors = require("cors");

const app = express();

/* =========================================================
   CONFIGURACIÓN Y VARIABLES DE ENTORNO
   ========================================================= */

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN_MP = process.env.ACCESS_TOKEN_MP;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID; 

const TABLA_REGISTRO = "REGISTRO";
const WEBHOOK_URL = "https://mpmm.onrender.com/webhook-mp";

const PLANES = {
  1: { titulo: "Membresía NIVEL 1", precio: 20 },
  2: { titulo: "Membresía NIVEL 2", precio: 25 },
  3: { titulo: "Membresía NIVEL 3", precio: 30 }
};

// Validación de configuración inicial
const REQUIRED_ENV_VARS = [
  { name: "ACCESS_TOKEN_MP", value: ACCESS_TOKEN_MP },
  { name: "AIRTABLE_TOKEN", value: AIRTABLE_TOKEN },
  { name: "AIRTABLE_BASE_ID", value: AIRTABLE_BASE_ID } 
];

REQUIRED_ENV_VARS.forEach(({ name, value }) => {
  if (!value) console.warn(`⚠️ Advertencia: Falta la variable de entorno ${name}`);
});

/* =========================================================
   MIDDLEWARES
   ========================================================= */

app.use(cors());
app.use(express.json());

/* =========================================================
   RUTAS PRINCIPALES & HEALTH CHECK
   ========================================================= */

app.get("/", (req, res) => {
  res.send("🚀 Servidor de Membresías funcionando correctamente.");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    servidor: "mpmm",
    entorno: "produccion"
  });
});

/* =========================================================
   RUTAS DE MERCADO PAGO
   ========================================================= */

/**
 * Crear enlace/suscripción de pago recurrente en Mercado Pago
 */
app.post("/crear-link-pago", async (req, res) => {
  console.log("💰 CREANDO SUSCRIPCIÓN");
  console.log("📦 Datos recibidos:", req.body);

  const { nivel, usuarioTelefono } = req.body;
  const planInfo = PLANES[nivel];

  // Validar nivel
  if (!planInfo) {
    return res.status(400).json({
      error: "Nivel de membresía inválido."
    });
  }

  // Validar teléfono
  if (!usuarioTelefono) {
    return res.status(400).json({
      error: "Falta el teléfono del usuario."
    });
  }

  try {
    // =====================================================
    // BUSCAR USUARIO EN REGISTRO POR TELÉFONO
    // =====================================================
    const formula = encodeURIComponent(`{Telefono}='${usuarioTelefono}'`);
    const buscarUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLA_REGISTRO)}?filterByFormula=${formula}`;

    const buscarRes = await fetch(buscarUrl, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`
      }
    });

    const registro = await buscarRes.json();

    if (!buscarRes.ok) {
      console.error("❌ Error consultando REGISTRO:", JSON.stringify(registro, null, 2));
      return res.status(500).json({
        error: "No se pudo consultar el usuario en REGISTRO."
      });
    }

    if (!registro.records || registro.records.length === 0) {
      console.warn(`⚠️ No se encontró usuario con teléfono: ${usuarioTelefono}`);
      return res.status(404).json({
        error: "No se encontró el usuario en REGISTRO."
      });
    }

    // =====================================================
    // OBTENER EMAIL DESDE REGISTRO
    // =====================================================
     const usuario = registro.records[0];
     const emailUsuario = usuario.fields.Email;

// =====================================================
// PROMOCIÓN
// =====================================================
const promocionActual = Number(usuario.fields.PROMOCION || 0);

const precioNormal = planInfo.precio;

const precioCobro =
  promocionActual < 3
    ? Number((precioNormal * 0.75).toFixed(2))
    : precioNormal;

console.log(`🎁 Promoción actual: ${promocionActual}/3`);
console.log(`💰 Precio normal: ${precioNormal}`);
console.log(`💰 Precio de este cobro: ${precioCobro}`);

    if (!emailUsuario) {
      console.warn(`⚠️ El usuario ${usuarioTelefono} no tiene Email registrado.`);
      return res.status(400).json({
        error: "El usuario no tiene un email registrado."
      });
    }

    console.log(`📧 Email obtenido de REGISTRO: ${emailUsuario}`);

    // =====================================================
    // CREAR SUSCRIPCIÓN EN MERCADO PAGO
    // =====================================================
    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN_MP}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: planInfo.titulo,
        // Email obtenido directamente desde Airtable
        payer_email: emailUsuario,
        // Teléfono utilizado como referencia del usuario
        external_reference: String(usuarioTelefono),
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: precioCobro,
          currency_id: "ARS"
        },
        back_url: "https://mmseguridad-c630f.web.app/MenuLateral.html",
        notification_url: WEBHOOK_URL
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Error Mercado Pago:", JSON.stringify(data, null, 2));
      return res.status(response.status).json({
        error: data.message || "No se pudo crear la suscripción."
      });
    }

    console.log("🆔 Preapproval creado:", data.id);
    console.log("📌 Estado inicial:", data.status);
    console.log(`👤 Usuario: ${usuarioTelefono}`);
    console.log(`📧 Payer: ${emailUsuario}`);
    console.log(`⭐ Plan: ${planInfo.titulo}`);

    return res.json({
      init_point: data.init_point,
      id: data.id
    });

  } catch (err) {
    console.error("❌ Error en /crear-link-pago:", err);
    return res.status(500).json({
      error: "Error interno al crear la suscripción."
    });
  }
});

/**
 * Webhook para recibir notificaciones de eventos de Mercado Pago
 */
app.post("/webhook-mp", async (req, res) => {
  console.log("🔔 WEBHOOK RECIBIDO");
  console.log(JSON.stringify(req.body, null, 2));

  // Confirmar recepción inmediatamente a Mercado Pago
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const { type, data } = body;

    // =========================================================
    // 1. CAMBIOS EN LA SUSCRIPCIÓN
    // =========================================================
    if (type === "subscription_preapproval") {

      if (!data?.id) {
        console.log("⚠️ Webhook sin ID de suscripción.");
        return;
      }

      const preapprovalId = data.id;
      console.log("🔎 Consultando suscripción:", preapprovalId);

      const mpRes = await fetch(
        `https://api.mercadopago.com/preapproval/${preapprovalId}`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN_MP}`
          }
        }
      );

      const suscripcion = await mpRes.json();

      if (!mpRes.ok) {
        console.error(
          "❌ Error consultando preapproval:",
          JSON.stringify(suscripcion, null, 2)
        );
        return;
      }

      console.log("📋 Suscripción:", JSON.stringify(suscripcion, null, 2));

      const usuarioTelefono = suscripcion.external_reference;

      if (!usuarioTelefono) {
        console.error("❌ La suscripción no tiene external_reference.");
        return;
      }

      console.log("👤 Usuario:", usuarioTelefono);

      // =======================================================
      // SUSCRIPCIÓN CANCELADA
      // =======================================================
      if (suscripcion.status === "cancelled") {
        console.log("❌ SUSCRIPCIÓN CANCELADA:", usuarioTelefono);

        await actualizarMembresiaEnAirtable(usuarioTelefono, "NIVEL 0");

        console.log("🔻 Membresía cambiada a NIVEL 0");
        return;
      }

      // =======================================================
      // SUSCRIPCIÓN AUTORIZADA
      // =======================================================
      if (suscripcion.status === "authorized") {
        const tituloPlan = suscripcion.reason || "";
        const matchNivel = tituloPlan.match(/NIVEL [1-3]/);
        const nuevoNivel = matchNivel ? matchNivel[0] : null;

        if (!nuevoNivel) {
          console.error("❌ No se pudo determinar el nivel:", tituloPlan);
          return;
        }

        console.log(
          `💳 Suscripción autorizada | 👤 Usuario: ${usuarioTelefono} | ⭐ Membresía: ${nuevoNivel}`
        );

        await actualizarMembresiaEnAirtable(usuarioTelefono, nuevoNivel);

        console.log(`✅ Membresía actualizada a ${nuevoNivel}`);
        return;
      }

      // =======================================================
      // OTROS ESTADOS
      // =======================================================
      console.log("ℹ️ Estado de suscripción:", suscripcion.status);
      return;
    }

    // =========================================================
    // 2. PAGOS RECURRENTES
    // =========================================================
    if (type === "subscription_authorized_payment") {

      if (!data?.id) {
        console.log("⚠️ Pago recurrente sin ID.");
        return;
      }

      const pagoId = data.id;
      console.log("💳 Pago recurrente recibido:", pagoId);

      // Consultar información del pago recurrente
      const pagoRes = await fetch(
        `https://api.mercadopago.com/authorized_payments/${pagoId}`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN_MP}`
          }
        }
      );

      const pago = await pagoRes.json();

      if (!pagoRes.ok) {
        console.error(
          "❌ Error consultando pago recurrente:",
          JSON.stringify(pago, null, 2)
        );
        return;
      }

      console.log("📋 Pago recurrente:", JSON.stringify(pago, null, 2));

      // -------------------------------------------------------
      // IMPORTANTE:
      // El pago recurrente puede traer el ID de la suscripción.
      // -------------------------------------------------------
      const preapprovalId = pago.preapproval_id || pago.subscription_id;

      if (!preapprovalId) {
        console.log("⚠️ No se encontró ID de suscripción en el pago.");
        return;
      }

      console.log("🔎 Consultando suscripción relacionada:", preapprovalId);

      // Consultamos la suscripción para obtener:
      // - external_reference
      // - reason
      // - status
      const suscripcionRes = await fetch(
        `https://api.mercadopago.com/preapproval/${preapprovalId}`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN_MP}`
          }
        }
      );

      const suscripcion = await suscripcionRes.json();

      if (!suscripcionRes.ok) {
        console.error(
          "❌ Error consultando suscripción:",
          JSON.stringify(suscripcion, null, 2)
        );
        return;
      }

      const usuarioTelefono = suscripcion.external_reference;

      if (!usuarioTelefono) {
        console.error("❌ La suscripción no tiene external_reference.");
        return;
      }

      console.log("👤 Usuario relacionado:", usuarioTelefono);

      // =======================================================
      // PAGO APROBADO
      // =======================================================
      if (pago.status === "processed" || pago.status === "approved") {
        const tituloPlan = suscripcion.reason || "";
        const matchNivel = tituloPlan.match(/NIVEL [1-3]/);
        const nuevoNivel = matchNivel ? matchNivel[0] : null;

        if (!nuevoNivel) {
          console.error("❌ No se pudo determinar el nivel del plan.");
          return;
        }

        console.log(
          `✅ PAGO RECURRENTE APROBADO | 👤 ${usuarioTelefono} | ⭐ ${nuevoNivel}`
        );

        await actualizarMembresiaEnAirtable(usuarioTelefono, nuevoNivel);

        console.log("✅ Membresía mantenida/actualizada.");
        return;
      }

      // =======================================================
      // PAGO RECHAZADO / EN REINTENTO
      // =======================================================
      if (pago.status === "recycling" || pago.status === "pending") {
        console.log(
          `⚠️ Pago rechazado o pendiente | Usuario: ${usuarioTelefono} | Estado: ${pago.status}`
        );
        console.log(
          "⏳ NO se baja la membresía todavía. Mercado Pago puede reintentar el cobro."
        );
        return;
      }

      // =======================================================
      // OTROS ESTADOS
      // =======================================================
      console.log("ℹ️ Estado del pago recurrente:", pago.status);
      return;
    }

    // =========================================================
    // 3. EVENTO NO RELACIONADO
    // =========================================================
    console.log("ℹ️ Evento ignorado:", type);

  } catch (err) {
    console.error("❌ Error procesando webhook:", err);
  }
});

/**
 * Consultar estado de una suscripción manualmente por ID
 */
app.get("/estado-preapproval/:id", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.mercadopago.com/preapproval/${req.params.id}`,
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN_MP}` }
      }
    );

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("❌ Error consultando preapproval:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* =========================================================
   SERVICIOS AUXILIARES (AIRTABLE)
   ========================================================= */

/**
 * Actualiza la membresía de un usuario en Airtable buscando por teléfono
 */
async function actualizarMembresiaEnAirtable(telefono, nuevoNivel) {
  try {
    console.log(`🔎 Buscando usuario en Airtable: ${telefono}`);

    const formula = encodeURIComponent(`{Telefono}='${telefono}'`);
    const buscarUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLA_REGISTRO)}?filterByFormula=${formula}`;

    const buscarRes = await fetch(buscarUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });

    const data = await buscarRes.json();

    if (!buscarRes.ok) {
      console.error("❌ Error buscando usuario en Airtable:", JSON.stringify(data, null, 2));
      return;
    }

    if (!data.records || data.records.length === 0) {
      console.warn(`⚠️ No se encontró usuario con teléfono ${telefono}`);
      return;
    }

    const recordId = data.records[0].id;
    console.log("🆔 Registro Airtable encontrado:", recordId);

    const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLA_REGISTRO)}/${recordId}`;

    const updateRes = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          MEMBRESIA: [nuevoNivel]
        }
      })
    });

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      console.error("❌ Error actualizando Airtable:", JSON.stringify(updateData, null, 2));
      return;
    }

    console.log(`✅ AIRTABLE ACTUALIZADO | 👤 Usuario: ${telefono} | ⭐ Membresía: ${nuevoNivel}`);
  } catch (err) {
    console.error("❌ Error Airtable:", err);
  }
}

/* =========================================================
   INICIALIZACIÓN DEL SERVIDOR
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
  console.log("🌎 Entorno: PRODUCCIÓN");
});
