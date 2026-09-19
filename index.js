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
  1: { titulo: "Membresía NIVEL 1", precio: 10000 },
  2: { titulo: "Membresía NIVEL 2", precio: 15000 },
  3: { titulo: "Membresía NIVEL 3", precio: 20000 }
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

  const { nivel, usuarioTelefono, email } = req.body;
  const planInfo = PLANES[nivel];

  // Validaciones de entrada
  if (!planInfo) {
    return res.status(400).json({ error: "Nivel de membresía inválido." });
  }
  if (!usuarioTelefono) {
    return res.status(400).json({ error: "Falta el teléfono del usuario." });
  }
  if (!email) {
    return res.status(400).json({ error: "Falta el email del usuario." });
  }

  try {
    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN_MP}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: planInfo.titulo,
        payer_email: email,
        external_reference: String(usuarioTelefono),
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: planInfo.precio,
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

    if (type !== "subscription_preapproval" || !data?.id) {
      console.log("ℹ️ Evento ignorado:", type);
      return;
    }

    const preapprovalId = data.id;
    console.log("🔎 Consultando suscripción:", preapprovalId);

    // Consultar estado actualizado directo a la API de MP
    const mpRes = await fetch(
      `https://api.mercadopago.com/preapproval/${preapprovalId}`,
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN_MP}` }
      }
    );

    const suscripcion = await mpRes.json();

    if (!mpRes.ok) {
      console.error("❌ Error consultando preapproval:", JSON.stringify(suscripcion, null, 2));
      return;
    }

    console.log("📋 Suscripción:", JSON.stringify(suscripcion, null, 2));

    if (suscripcion.status !== "authorized") {
      console.log("ℹ️ Suscripción todavía no autorizada:", suscripcion.status);
      return;
    }

    const usuarioTelefono = suscripcion.external_reference;
    const tituloPlan = suscripcion.reason || "";

    if (!usuarioTelefono) {
      console.error("❌ La suscripción no tiene external_reference.");
      return;
    }

    // Determinar nivel contratado
    const matchNivel = tituloPlan.match(/NIVEL [1-3]/);
    const nuevoNivel = matchNivel ? matchNivel[0] : null;

    if (!nuevoNivel) {
      console.error("❌ No se pudo determinar el nivel:", tituloPlan);
      return;
    }

    console.log(`💳 Suscripción autorizada | 👤 Usuario: ${usuarioTelefono} | ⭐ Membresía: ${nuevoNivel}`);

    // Actualizar base de datos
    await actualizarMembresiaEnAirtable(usuarioTelefono, nuevoNivel);
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
