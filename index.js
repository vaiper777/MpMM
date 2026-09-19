const express = require("express");
const cors = require("cors");

const app = express();

// Permitir peticiones desde tu app web
app.use(cors());
app.use(express.json());

// Claves de configuración
const ACCESS_TOKEN_MP = "APP_USR-4053974077909740-091817-95fcf425269f62158f0227dd2bbca0e2-3699900550";
const AIRTABLE_TOKEN = "pattnrYUBwzOfZadM.564e331fab1fac9fd68ea5d31bdb6991f9e6f7537f65bd75558ad849dccbac69";
const AIRTABLE_BASE_ID = "app2S4wHymS877hSG";
const TABLA_REGISTRO = "REGISTRO";

// Precios y títulos según el nivel de membresía
const PLANES = {
  1: { titulo: "Membresía NIVEL 1", precio: 10000 },
  2: { titulo: "Membresía NIVEL 2", precio: 15000 },
  3: { titulo: "Membresía NIVEL 3", precio: 20000 }
};

// Ruta de prueba para verificar que el servidor está encendido
app.get("/", (req, res) => {
  res.send("🚀 Servidor de Membresías funcionando correctamente.");
});

// 1. RUTA PARA CREAR EL LINK DE PAGO EN MERCADO PAGO
app.post("/crear-link-pago", async (req, res) => {
  const { nivel, usuarioTelefono, email } = req.body;
  const planInfo = PLANES[nivel];

  if (!planInfo || !usuarioTelefono) {
    return res.status(400).json({ error: "Faltan datos requeridos (nivel o teléfono)." });
  }

  // Si envías un email desde el frontend se usa ese; si no, coloca tu correo de prueba de Sandbox
  const emailPagador = "test_user_3146184926779850939@testuser.com";

  try {
    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN_MP}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: planInfo.titulo,
        payer_email: emailPagador,
        external_reference: usuarioTelefono,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: planInfo.precio,
          currency_id: "ARS"
        },
        back_url: "https://mmseguridad-c630f.web.app/MenuLateral.html"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Error Mercado Pago:", data);
      throw new Error(data.message || "No se pudo generar el pago.");
    }

    // En Sandbox se recomienda devolver sandbox_init_point
    res.json({ init_point: data.sandbox_init_point || data.init_point });
  } catch (err) {
    console.error("Error en /crear-link-pago:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. RUTA WEBHOOK: MERCADO PAGO AVISA AQUÍ CUANDO SE REALIZA EL PAGO
app.post("/webhook-mp", async (req, res) => {
  // Manejo seguro por si req.body llega sin definir
  const { type, data } = req.body || {};

  try {
    if ((type === "subscription_preapproval" || type === "payment") && data?.id) {
      const id = data.id;

      // Consultar el estado real de la suscripción en Mercado Pago
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN_MP}` }
      });

      if (mpRes.ok) {
        const suscripcion = await mpRes.json();

        // Si el pago fue aprobado/autorizado
        if (suscripcion.status === "authorized") {
          const usuarioTelefono = suscripcion.external_reference;
          const tituloPlan = suscripcion.reason;

          let nuevoNivel = "NIVEL 0";
          if (tituloPlan.includes("NIVEL 1")) nuevoNivel = "NIVEL 1";
          if (tituloPlan.includes("NIVEL 2")) nuevoNivel = "NIVEL 2";
          if (tituloPlan.includes("NIVEL 3")) nuevoNivel = "NIVEL 3";

          console.log(`💳 Pago recibido. Otorgando ${nuevoNivel} a usuario: ${usuarioTelefono}`);

          // Actualizar Airtable automáticamente
          await actualizarMembresiaEnAirtable(usuarioTelefono, nuevoNivel);
        }
      }
    }

    // Mercado Pago requiere que siempre respondamos 200 OK
    res.sendStatus(200);
  } catch (err) {
    console.error("Error en /webhook-mp:", err.message);
    res.sendStatus(500);
  }
});

// Función para actualizar el campo MEMBRESIA en Airtable
async function actualizarMembresiaEnAirtable(telefono, nuevoNivel) {
  const formula = encodeURIComponent(`{Telefono}='${telefono}'`);
  const buscarUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLA_REGISTRO)}?filterByFormula=${formula}`;

  const res = await fetch(buscarUrl, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  const data = await res.json();

  if (data.records && data.records.length > 0) {
    const recordId = data.records[0].id;
    const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLA_REGISTRO)}/${recordId}`;

    await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: { MEMBRESIA: [nuevoNivel] }
      })
    });
    console.log(`✅ Airtable actualizado: Usuario ${telefono} ahora tiene ${nuevoNivel}`);
  } else {
    console.warn(`⚠️ No se encontró ningún usuario registrado con el teléfono: ${telefono}`);
  }
}

// Iniciar servidor en el puerto 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
});
