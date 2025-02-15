const { MongoClient } = require("mongodb");
require("dotenv").config();

const client = new MongoClient(process.env.MONGO_URI);

async function connectDB() {
    await client.connect();
    console.log("Connected to MongoDB");
    return client.db("ilearncore"); // Change database name accordingly
}

module.exports = connectDB;
