const express = require("express");
const cors = require("cors");

const app = express();

// Permitir peticiones desde tu app web
app.use(cors());
app.use(express.json());

// Claves de configuración
const ACCESS_TOKEN_MP = "APP_USR-6205728868317147-091912-afff033a137054490384517b1c446838-3699900550";
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
  console.log("💰 CREANDO LINK DE PAGO", req.body);
  const { nivel, usuarioTelefono, email } = req.body;
  const planInfo = PLANES[nivel];

  if (!planInfo || !usuarioTelefono) {
    return res.status(400).json({ error: "Faltan datos requeridos (nivel o teléfono)." });
  }

  const emailPagador = "test_user_3146184926779850939@testuser.com";

  console.log("👤 Payer usado:", emailPagador);

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
        back_url: "https://mmseguridad-c630f.web.app/MenuLateral.html",
        notification_url: "https://mpmm.onrender.com/webhook-mp"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Error Mercado Pago:", data);
      throw new Error(data.message || "No se pudo generar el pago.");
    }
    console.log("🆔 Preapproval creado:", data.id);
    res.json({ init_point: data.sandbox_init_point || data.init_point });
  } catch (err) {
    console.error("Error en /crear-link-pago:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. RUTA WEBHOOK: MERCADO PAGO AVISA AQUÍ CUANDO SE REALIZA EL PAGO
app.post("/webhook-mp", async (req, res) => {
  console.log("🔔 WEBHOOK RECIBIDO");
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);
});

    // Mercado Pago requiere que siempre respondamos 200 OK
    res.sendStatus(200);
  } catch (err) {
    console.error("Error en /webhook-mp:", err.message);
    res.sendStatus(500);
  }
});






app.get("/estado-preapproval/:id", async (req, res) => {
  try {
    const response = await fetch(`https://api.mercadopago.com/preapproval/${req.params.id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN_MP}` }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});






app.get("/test-token", async (req, res) => {
  try {
    const response = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN_MP}` }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
