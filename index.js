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

const REQUIRED_ENV_VARS = [
  { name: "ACCESS_TOKEN_MP", value: ACCESS_TOKEN_MP },
  { name: "AIRTABLE_TOKEN", value: AIRTABLE_TOKEN },
  { name: "AIRTABLE_BASE_ID", value: AIRTABLE_BASE_ID }
];

REQUIRED_ENV_VARS.forEach(({ name, value }) => {
  if (!value) {
    console.warn(
      `⚠️ Advertencia: Falta la variable de entorno ${name}`
    );
  }
});

/* =========================================================
   MIDDLEWARES
   ========================================================= */

app.use(cors());
app.use(express.json());

/* =========================================================
   RUTAS PRINCIPALES
   ========================================================= */

app.get("/", (req, res) => {
  res.send(
    "🚀 Servidor de Membresías funcionando correctamente."
  );
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    servidor: "mpmm",
    entorno: "produccion"
  });
});

/* =========================================================
   CREAR SUSCRIPCIÓN
   ========================================================= */

app.post("/crear-link-pago", async (req, res) => {

  console.log("💰 CREANDO SUSCRIPCIÓN");
  console.log("📦 Datos recibidos:", req.body);

  const { nivel, usuarioTelefono } = req.body;
  const planInfo = PLANES[nivel];

  if (!planInfo) {
    return res.status(400).json({
      error: "Nivel de membresía inválido."
    });
  }

  if (!usuarioTelefono) {
    return res.status(400).json({
      error: "Falta el teléfono del usuario."
    });
  }

  try {

    const formula = encodeURIComponent(
      `{Telefono}='${usuarioTelefono}'`
    );

    const buscarUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/` +
      `${encodeURIComponent(TABLA_REGISTRO)}` +
      `?filterByFormula=${formula}`;

    const buscarRes = await fetch(buscarUrl, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`
      }
    });

    const registro = await buscarRes.json();

    if (!buscarRes.ok) {

      console.error(
        "❌ Error consultando REGISTRO:",
        JSON.stringify(registro, null, 2)
      );

      return res.status(500).json({
        error: "No se pudo consultar el usuario en REGISTRO."
      });
    }

    if (
      !registro.records ||
      registro.records.length === 0
    ) {

      console.warn(
        `⚠️ No se encontró usuario con teléfono: ${usuarioTelefono}`
      );

      return res.status(404).json({
        error: "No se encontró el usuario en REGISTRO."
      });
    }

    const usuario = registro.records[0];
    const emailUsuario = usuario.fields.Email;

    /* =====================================================
       PROMOCIÓN
       ===================================================== */

    const promocionActual =
      Number(usuario.fields.PROMOCION || 0);

    const precioNormal = planInfo.precio;

    const precioCobro =
      promocionActual < 3
        ? Number((precioNormal * 0.75).toFixed(2))
        : precioNormal;

    console.log(
      `🎁 Promoción actual: ${promocionActual}/3`
    );

    console.log(
      `💰 Precio normal: ${precioNormal}`
    );

    console.log(
      `💰 Precio de este cobro: ${precioCobro}`
    );

    if (!emailUsuario) {

      console.warn(
        `⚠️ El usuario ${usuarioTelefono} no tiene Email registrado.`
      );

      return res.status(400).json({
        error: "El usuario no tiene un email registrado."
      });
    }

    console.log(
      `📧 Email obtenido de REGISTRO: ${emailUsuario}`
    );

    /* =====================================================
       CREAR SUSCRIPCIÓN EN MERCADO PAGO
       ===================================================== */

    const response = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN_MP}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          reason: planInfo.titulo,

          payer_email: emailUsuario,

          external_reference:
            String(usuarioTelefono),

          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: precioCobro,
            currency_id: "ARS"
          },

          back_url:
            "https://mmseguridad-c630f.web.app/MenuLateral.html",

          notification_url: WEBHOOK_URL
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {

      console.error(
        "❌ Error Mercado Pago:",
        JSON.stringify(data, null, 2)
      );

      return res.status(response.status).json({
        error:
          data.message ||
          "No se pudo crear la suscripción."
      });
    }

    console.log(
      "🆔 Preapproval creado:",
      data.id
    );

    console.log(
      "📌 Estado inicial:",
      data.status
    );

    console.log(
      `👤 Usuario: ${usuarioTelefono}`
    );

    console.log(
      `📧 Payer: ${emailUsuario}`
    );

    console.log(
      `⭐ Plan: ${planInfo.titulo}`
    );

    return res.json({
      init_point: data.init_point,
      id: data.id
    });

  } catch (err) {

    console.error(
      "❌ Error en /crear-link-pago:",
      err
    );

    return res.status(500).json({
      error:
        "Error interno al crear la suscripción."
    });
  }
});


/* =========================================================
   ACTUALIZAR PROMOCIÓN
   ========================================================= */

async function actualizarPromocionEnAirtable(telefono) {

  const formula = encodeURIComponent(
    `{Telefono}='${telefono}'`
  );

  const buscarUrl =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/` +
    `${encodeURIComponent(TABLA_REGISTRO)}` +
    `?filterByFormula=${formula}`;

  const buscarRes = await fetch(buscarUrl, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`
    }
  });

  const registro = await buscarRes.json();

  if (!buscarRes.ok) {

    throw new Error(
      `Error consultando PROMOCION: ${JSON.stringify(registro)}`
    );
  }

  if (
    !registro.records ||
    registro.records.length === 0
  ) {

    throw new Error(
      `No se encontró usuario: ${telefono}`
    );
  }

  const usuario = registro.records[0];

  const promocionActual =
    Number(usuario.fields.PROMOCION || 0);

  const nuevaPromocion =
    Math.min(promocionActual + 1, 3);

  const actualizarRes = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/` +
    `${encodeURIComponent(TABLA_REGISTRO)}/${usuario.id}`,
    {
      method: "PATCH",

      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        fields: {
          PROMOCION: String(nuevaPromocion)
        }
      })
    }
  );

  const actualizarData =
    await actualizarRes.json();

  if (!actualizarRes.ok) {

    throw new Error(
      `Error actualizando PROMOCION: ${JSON.stringify(actualizarData)}`
    );
  }

  console.log(
    `🎁 PROMOCION actualizada: ${promocionActual} → ${nuevaPromocion}`
  );

  return {
    promocionAnterior: promocionActual,
    promocionNueva: nuevaPromocion
  };
}


/* =========================================================
   VERIFICAR PAGO DUPLICADO
   ========================================================= */

async function verificarPagoYaProcesado(
  telefono,
  pagoId
) {

  const formula = encodeURIComponent(
    `{Telefono}='${telefono}'`
  );

  const response = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/REGISTRO?filterByFormula=${formula}`,
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`
      }
    }
  );

  const data = await response.json();

  if (
    !response.ok ||
    !data.records?.length
  ) {

    console.error(
      "❌ No se pudo consultar el último pago."
    );

    return false;
  }

  const registro = data.records[0];

  const ultimoPago =
    registro.fields?.["ULTIMO PAGO MP"] || "";

  if (
    String(ultimoPago) ===
    String(pagoId)
  ) {

    console.log(
      `⚠️ PAGO DUPLICADO DETECTADO: ${pagoId}`
    );

    return true;
  }

  return false;
}


/* =========================================================
   GUARDAR ÚLTIMO PAGO
   ========================================================= */

async function guardarUltimoPagoMP(
  telefono,
  pagoId
) {

  try {

    const formula = encodeURIComponent(
      `{Telefono}='${telefono}'`
    );

    const response = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/REGISTRO?filterByFormula=${formula}`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`
        }
      }
    );

    const data = await response.json();

    if (
      !response.ok ||
      !data.records?.length
    ) {

      console.error(
        "❌ No se encontró el usuario para guardar el pago."
      );

      return false;
    }

    const recordId =
      data.records[0].id;

    const updateResponse = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/REGISTRO/${recordId}`,
      {
        method: "PATCH",

        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          fields: {
            "ULTIMO PAGO MP":
              String(pagoId)
          }
        })
      }
    );

    const updateData =
      await updateResponse.json();

    if (!updateResponse.ok) {

      console.error(
        "❌ Error guardando ULTIMO PAGO MP:",
        JSON.stringify(
          updateData,
          null,
          2
        )
      );

      return false;
    }

    console.log(
      `💾 Pago ${pagoId} guardado en Airtable.`
    );

    return true;

  } catch (err) {

    console.error(
      "❌ Error guardando último pago MP:",
      err
    );

    return false;
  }
}


/* =========================================================
   ACTUALIZAR PRECIO DE SUSCRIPCIÓN
   ========================================================= */

async function actualizarPrecioSuscripcionMP(
  preapprovalId,
  nuevoPrecio
) {

  try {

    console.log(
      `💰 Actualizando suscripción ${preapprovalId} a $${nuevoPrecio}`
    );

    const response = await fetch(
      `https://api.mercadopago.com/preapproval/${preapprovalId}`,
      {
        method: "PUT",

        headers: {
          Authorization:
            `Bearer ${ACCESS_TOKEN_MP}`,
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          auto_recurring: {
            transaction_amount:
              nuevoPrecio,
            currency_id: "ARS"
          }
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok) {

      console.error(
        "❌ Error actualizando precio en Mercado Pago:",
        JSON.stringify(data, null, 2)
      );

      return false;
    }

    console.log(
      `✅ PRECIO ACTUALIZADO EN MERCADO PAGO: $${nuevoPrecio}`
    );

    return true;

  } catch (err) {

    console.error(
      "❌ Error actualizando precio de suscripción:",
      err
    );

    return false;
  }
}


/* =========================================================
   WEBHOOK MERCADO PAGO
   ========================================================= */

app.post("/webhook-mp", async (req, res) => {

  console.log("🔔 WEBHOOK RECIBIDO");

  console.log(
    JSON.stringify(req.body, null, 2)
  );

  res.sendStatus(200);

  try {

    const body = req.body || {};
    const { type, data } = body;


    /* =====================================================
       1. CAMBIOS EN LA SUSCRIPCIÓN
       ===================================================== */

    if (
      type === "subscription_preapproval"
    ) {

      if (!data?.id) {

        console.log(
          "⚠️ Webhook sin ID de suscripción."
        );

        return;
      }

      const preapprovalId =
        data.id;

      console.log(
        "🔎 Consultando suscripción:",
        preapprovalId
      );

      const mpRes = await fetch(
        `https://api.mercadopago.com/preapproval/${preapprovalId}`,
        {
          headers: {
            Authorization:
              `Bearer ${ACCESS_TOKEN_MP}`
          }
        }
      );

      const suscripcion =
        await mpRes.json();

      if (!mpRes.ok) {

        console.error(
          "❌ Error consultando preapproval:",
          JSON.stringify(
            suscripcion,
            null,
            2
          )
        );

        return;
      }

      const usuarioTelefono =
        suscripcion.external_reference;

      if (!usuarioTelefono) {

        console.error(
          "❌ La suscripción no tiene external_reference."
        );

        return;
      }

      console.log(
        "👤 Usuario:",
        usuarioTelefono
      );


      /* ===================================================
         SUSCRIPCIÓN CANCELADA
         =================================================== */

      if (
        suscripcion.status ===
        "cancelled"
      ) {

        console.log(
          "❌ SUSCRIPCIÓN CANCELADA:",
          usuarioTelefono
        );

        await actualizarMembresiaEnAirtable(
          usuarioTelefono,
          "NIVEL 0"
        );

        return;
      }


      /* ===================================================
         SUSCRIPCIÓN AUTORIZADA
         =================================================== */

      if (
        suscripcion.status ===
        "authorized"
      ) {

        const tituloPlan =
          suscripcion.reason || "";

        const matchNivel =
          tituloPlan.match(
            /NIVEL [1-3]/
          );

        const nuevoNivel =
          matchNivel
            ? matchNivel[0]
            : null;

        if (!nuevoNivel) {

          console.error(
            "❌ No se pudo determinar el nivel:",
            tituloPlan
          );

          return;
        }

        console.log(
          `💳 Suscripción autorizada | 👤 ${usuarioTelefono} | ⭐ ${nuevoNivel}`
        );

        const actualizada =
          await actualizarMembresiaEnAirtable(
            usuarioTelefono,
            nuevoNivel
          );

        if (!actualizada) {

          console.error(
            "❌ No se pudo actualizar la membresía."
          );
        }

        return;
      }

      console.log(
        "ℹ️ Estado de suscripción:",
        suscripcion.status
      );

      return;
    }


    /* =====================================================
       2. PAGOS RECURRENTES
       ===================================================== */

    if (
      type ===
      "subscription_authorized_payment"
    ) {

      if (!data?.id) {

        console.log(
          "⚠️ Pago recurrente sin ID."
        );

        return;
      }

      const pagoId =
        data.id;

      console.log(
        "💳 Pago recurrente recibido:",
        pagoId
      );


      /* ===================================================
         CONSULTAR PAGO
         =================================================== */

      const pagoRes = await fetch(
        `https://api.mercadopago.com/authorized_payments/${pagoId}`,
        {
          headers: {
            Authorization:
              `Bearer ${ACCESS_TOKEN_MP}`
          }
        }
      );

      const pago =
        await pagoRes.json();

      if (!pagoRes.ok) {

        console.error(
          "❌ Error consultando pago recurrente:",
          JSON.stringify(
            pago,
            null,
            2
          )
        );

        return;
      }


      /* ===================================================
         OBTENER SUSCRIPCIÓN
         =================================================== */

      const preapprovalId =
        pago.preapproval_id ||
        pago.subscription_id;

      if (!preapprovalId) {

        console.log(
          "⚠️ No se encontró ID de suscripción en el pago."
        );

        return;
      }

      const suscripcionRes =
        await fetch(
          `https://api.mercadopago.com/preapproval/${preapprovalId}`,
          {
            headers: {
              Authorization:
                `Bearer ${ACCESS_TOKEN_MP}`
            }
          }
        );

      const suscripcion =
        await suscripcionRes.json();

      if (!suscripcionRes.ok) {

        console.error(
          "❌ Error consultando suscripción:",
          JSON.stringify(
            suscripcion,
            null,
            2
          )
        );

        return;
      }


      /* ===================================================
         OBTENER USUARIO
         =================================================== */

      const usuarioTelefono =
        suscripcion.external_reference;

      if (!usuarioTelefono) {

        console.error(
          "❌ La suscripción no tiene external_reference."
        );

        return;
      }


      /* ===================================================
         VERIFICAR DUPLICADO
         =================================================== */

      const pagoYaProcesado =
        await verificarPagoYaProcesado(
          usuarioTelefono,
          pagoId
        );

      if (pagoYaProcesado) {

        console.log(
          `⛔ El pago ${pagoId} ya fue procesado anteriormente.`
        );

        return;
      }


      /* ===================================================
         PAGO APROBADO
         =================================================== */

      if (
        pago.status === "processed" ||
        pago.status === "approved"
      ) {

        const tituloPlan =
          suscripcion.reason || "";

        const matchNivel =
          tituloPlan.match(
            /NIVEL [1-3]/
          );

        const nuevoNivel =
          matchNivel
            ? matchNivel[0]
            : null;

        if (!nuevoNivel) {

          console.error(
            "❌ No se pudo determinar el nivel del plan."
          );

          return;
        }


        /* =================================================
           ACTUALIZAR MEMBRESÍA
           ================================================= */

        const membresiaActualizada =
          await actualizarMembresiaEnAirtable(
            usuarioTelefono,
            nuevoNivel
          );

        if (!membresiaActualizada) {

          console.error(
            "❌ No se pudo actualizar la membresía."
          );

          return;
        }


        /* =================================================
           ACTUALIZAR PROMOCIÓN
           ================================================= */

        const resultadoPromocion =
          await actualizarPromocionEnAirtable(
            usuarioTelefono
          );

        console.log(
          `🎁 Promoción: ${resultadoPromocion.promocionAnterior} → ${resultadoPromocion.promocionNueva}`
        );


        /* =================================================
           QUITAR DESCUENTO DESPUÉS DEL 3° COBRO
           ================================================= */

        if (
          resultadoPromocion.promocionNueva === 3
        ) {

          const numeroNivel =
            Number(
              nuevoNivel.replace(
                "NIVEL ",
                ""
              )
            );

          const precioNormal =
            PLANES[numeroNivel].precio;

          console.log(
            `💰 Actualizando Mercado Pago al precio normal: $${precioNormal}`
          );

          const precioActualizado =
            await actualizarPrecioSuscripcionMP(
              preapprovalId,
              precioNormal
            );

          if (!precioActualizado) {

            console.error(
              `❌ No se pudo actualizar el precio de la suscripción ${preapprovalId}`
            );

            return;
          }

          console.log(
            `✅ Mercado Pago quedó configurado en $${precioNormal} para los próximos cobros.`
          );
        }


        /* =================================================
           GUARDAR ID DEL PAGO
           ================================================= */

        const pagoGuardado =
          await guardarUltimoPagoMP(
            usuarioTelefono,
            pagoId
          );

        if (!pagoGuardado) {

          console.error(
            "❌ No se pudo guardar ULTIMO PAGO MP."
          );

          return;
        }


        console.log(
          `💾 Pago ${pagoId} guardado en Airtable.`
        );

        console.log(
          "✅ PROCESAMIENTO DEL PAGO FINALIZADO"
        );

        return;
      }


      /* ===================================================
         PAGO PENDIENTE / REINTENTO
         =================================================== */

      if (
        pago.status === "recycling" ||
        pago.status === "pending"
      ) {

        console.log(
          `⚠️ Pago pendiente/reintento | Usuario: ${usuarioTelefono} | Estado: ${pago.status}`
        );

        return;
      }


      /* ===================================================
         OTROS ESTADOS
         =================================================== */

      console.log(
        "ℹ️ Estado del pago recurrente:",
        pago.status
      );

      return;
    }


    /* =====================================================
       3. EVENTO NO RELACIONADO
       ===================================================== */

    console.log(
      "ℹ️ Evento ignorado:",
      type
    );

  } catch (err) {

    console.error(
      "❌ Error procesando webhook:",
      err
    );
  }
});


/* =========================================================
   ESTADO DE SUSCRIPCIÓN
   ========================================================= */

app.get(
  "/estado-preapproval/:id",
  async (req, res) => {

    try {

      const response =
        await fetch(
          `https://api.mercadopago.com/preapproval/${req.params.id}`,
          {
            headers: {
              Authorization:
                `Bearer ${ACCESS_TOKEN_MP}`
            }
          }
        );

      const data =
        await response.json();

      return res
        .status(response.status)
        .json(data);

    } catch (err) {

      console.error(
        "❌ Error consultando preapproval:",
        err
      );

      return res.status(500).json({
        error: err.message
      });
    }
  }
);


/* =========================================================
   ACTUALIZAR MEMBRESÍA EN AIRTABLE
   ========================================================= */

async function actualizarMembresiaEnAirtable(
  telefono,
  nuevoNivel
) {

  try {

    console.log(
      `🔎 Buscando usuario en Airtable: ${telefono}`
    );

    const formula = encodeURIComponent(
      `{Telefono}='${telefono}'`
    );

    const buscarUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/` +
      `${encodeURIComponent(TABLA_REGISTRO)}` +
      `?filterByFormula=${formula}`;

    const buscarRes =
      await fetch(buscarUrl, {
        headers: {
          Authorization:
            `Bearer ${AIRTABLE_TOKEN}`
        }
      });

    const data =
      await buscarRes.json();

    if (!buscarRes.ok) {

      console.error(
        "❌ Error buscando usuario en Airtable:",
        JSON.stringify(
          data,
          null,
          2
        )
      );

      return false;
    }

    if (
      !data.records ||
      data.records.length === 0
    ) {

      console.warn(
        `⚠️ No se encontró usuario con teléfono ${telefono}`
      );

      return false;
    }

    const recordId =
      data.records[0].id;

    const updateUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/` +
      `${encodeURIComponent(TABLA_REGISTRO)}/${recordId}`;

    const updateRes =
      await fetch(updateUrl, {
        method: "PATCH",

        headers: {
          Authorization:
            `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          fields: {
            MEMBRESIA: [nuevoNivel]
          }
        })
      });

    const updateData =
      await updateRes.json();

    if (!updateRes.ok) {

      console.error(
        "❌ ERROR ACTUALIZANDO MEMBRESIA:",
        JSON.stringify(
          updateData,
          null,
          2
        )
      );

      return false;
    }

    console.log(
      `✅ AIRTABLE ACTUALIZADO | 👤 Usuario: ${telefono} | ⭐ Membresía: ${nuevoNivel}`
    );

    return true;

  } catch (err) {

    console.error(
      "❌ Error Airtable:",
      err
    );

    return false;
  }
}


/* =========================================================
   INICIALIZACIÓN
   ========================================================= */

app.listen(PORT, () => {

  console.log(
    `🚀 Servidor escuchando en puerto ${PORT}`
  );

  console.log(
    "🌎 Entorno: PRODUCCIÓN"
  );
});
