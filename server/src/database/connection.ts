import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "";
let client: MongoClient | null = null;

/**
 * Connect to MongoDB database
 */
export async function connectDB(): Promise<MongoClient> {
  if (client) {
    console.error("MongoDB client already connected");
    return client;
  }

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.error("Connected to MongoDB");
    return client;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    throw error;
  }
}

/**
 * Get the database instance
 */
export async function getDatabase() {
  if (!client) {
    await connectDB();
  }

  if (!client) {
    throw new Error("Failed to establish MongoDB connection");
  }

  return client.db(process.env.DB_NAME || "athly");
}

/**
 * Close database connection
 */
export async function closeDB(): Promise<void> {
  if (client) {
    await client.close();
    console.error("Disconnected from MongoDB");
    client = null;
  }
}

