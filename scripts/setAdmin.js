const admin = require("firebase-admin");

admin.initializeApp();

async function run() {
  const email = "payments@digiserve.ai"; // 👈 CHANGE THIS

  const user = await admin.auth().getUserByEmail(email);

  await admin.auth().setCustomUserClaims(user.uid, {
    admin: true,
  });

  console.log("✅ Admin role assigned to:", email);
}

run().catch(console.error);
