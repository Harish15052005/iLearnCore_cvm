const bcrypt = require("bcryptjs");
const connectDB = require("./db");

async function createAdmin() {
    const db = await connectDB();
    const hashedPassword = await bcrypt.hash("admin", 10);

    await db.collection("admins").insertOne({
        uname: "admin",
        password: hashedPassword,
        role: "admin"
    });

    console.log("Admin created successfully!");
    process.exit();
}

createAdmin();
