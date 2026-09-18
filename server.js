 
// generarSuscripcion.js
// Requiere Node 18+
// Crea un PLAN DE SUSCRIPCIÓN en Mercado Pago
// y devuelve el link para que el usuario se suscriba.

const readline = require("readline");

// ⚠️ Poné acá tu Access Token TEST de Mercado Pago
const ACCESS_TOKEN = "TEST-6135692971827029-050919-712d916e711408bedfe1837e682487a5-20475019";

async function generarPlanSuscripcion(
  titulo,
  precio,
  frecuencia = 1,
  moneda = "ARS"
) {
  const resp = await fetch(
    "https://api.mercadopago.com/preapproval_plan",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        reason: titulo,

        auto_recurring: {
          frequency: Number(frecuencia),
          frequency_type: "months",
          transaction_amount: Number(precio),
          currency_id: moneda,
        },

        // Cambialo por la dirección de tu página
        back_url: "https://www.google.com",
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Error ${resp.status}: ${err}`);
  }

  const plan = await resp.json();

  return plan;
}

function preguntar(pregunta) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(pregunta, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

(async () => {
  console.log("\n=== CREAR SUSCRIPCIÓN MERCADO PAGO ===\n");

  const titulo =
    (await preguntar(
      "Nombre de la membresía [Membresía Premium]: "
    )) || "Membresía Premium";

  const precio =
    (await preguntar(
      "Precio mensual [10000]: "
    )) || "10000";

  try {
    const plan = await generarPlanSuscripcion(
      titulo,
      precio
    );

    console.log("\n✅ PLAN DE SUSCRIPCIÓN CREADO\n");

    console.log("ID del plan:");
    console.log(plan.id);

    console.log("\nNombre:");
    console.log(plan.reason);

    console.log("\nPrecio:");
    console.log(plan.auto_recurring?.transaction_amount);

    console.log("\nFrecuencia:");
    console.log(
      `${plan.auto_recurring?.frequency} ${plan.auto_recurring?.frequency_type}`
    );

    console.log("\n🔗 LINK DE SUSCRIPCIÓN:");
    console.log(plan.init_point);

    console.log("\n=================================");
    console.log("Guardá este link para probarlo.");
    console.log("=================================\n");

  } catch (e) {
    console.error("\n❌ ERROR:");
    console.error(e.message);
  }
})(); 